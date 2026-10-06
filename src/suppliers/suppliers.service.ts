import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AccountStatus } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { Supplier } from './entities/supplier.entity';
import { CreateSupplierDto, ListSuppliersQueryDto, UpdateSupplierDto } from './dto/supplier.dto';
import { SupplierResponseDto } from './dto/supplier-response.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly repository: Repository<Supplier>,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  toResponse(supplier: Supplier): SupplierResponseDto {
    return {
      id: supplier.id,
      businessId: supplier.businessId,
      name: supplier.name,
      code: supplier.code,
      contactPerson: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      status: supplier.status,
    };
  }

  async findAll(
    query: ListSuppliersQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<SupplierResponseDto>> {
    // A SUPER_ADMIN may scope the list to one business; others are clamped
    // to their own.
    const businessId = this.authorization.resolveBusinessScope(actor, query.businessId ?? null);

    const builder = this.repository
      .createQueryBuilder('supplier')
      .where('supplier.deleted_at IS NULL')
      .orderBy('supplier.name', 'ASC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('supplier.business_id = :businessId', { businessId });

    if (query.search) {
      builder.andWhere('(supplier.name ILIKE :search OR supplier.code ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    if (query.status) builder.andWhere('supplier.status = :status', { status: query.status });

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<Supplier> {
    const supplier = await this.repository.findOne({ where: { id } });
    if (!supplier) throw notFound('The requested supplier was not found.');

    this.authorization.assertBusinessAccess(actor, supplier.businessId);
    return supplier;
  }

  /** Supplier for a new fuel order: must exist, be in scope and be active. */
  async requireUsableSupplier(
    id: string,
    businessId: string,
    manager?: EntityManager,
  ): Promise<Supplier> {
    const repository = manager ? manager.getRepository(Supplier) : this.repository;
    const supplier = await repository.findOne({ where: { id } });

    if (!supplier || supplier.businessId !== businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'The selected supplier is not available.');
    }

    if (supplier.status !== AccountStatus.ACTIVE) {
      throw invalidOperation(`Supplier ${supplier.code} is not active.`);
    }

    return supplier;
  }

  async create(
    dto: CreateSupplierDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
    manager?: EntityManager,
  ): Promise<Supplier> {
    const businessId = this.requireBusinessId(actor);
    const repository = manager ? manager.getRepository(Supplier) : this.repository;

    const created = repository.create({
      businessId,
      name: dto.name.trim(),
      code: dto.code,
      contactPerson: dto.contactPerson?.trim() ?? null,
      phone: dto.phone?.trim() ?? null,
      email: dto.email?.trim() ?? null,
      address: dto.address?.trim() ?? null,
      status: AccountStatus.ACTIVE,
    });

    const saved = await repository.save(created);

    await this.audit.record(
      { ...auditActor, userId: actor.id, businessId, branchId: null },
      {
        action: AuditAction.SUPPLIER_CREATED,
        resourceType: AuditResourceType.SUPPLIER,
        resourceId: saved.id,
        newValues: this.toResponse(saved) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
    manager?: EntityManager,
  ): Promise<Supplier> {
    const existing = await this.findOneOrFail(id, actor);
    const repository = manager ? manager.getRepository(Supplier) : this.repository;

    const patch: Partial<Supplier> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.contactPerson !== undefined) patch.contactPerson = dto.contactPerson?.trim() ?? null;
    if (dto.phone !== undefined) patch.phone = dto.phone?.trim() ?? null;
    if (dto.email !== undefined) patch.email = dto.email?.trim() ?? null;
    if (dto.address !== undefined) patch.address = dto.address?.trim() ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) {
      throw invalidOperation('No supported changes were supplied.');
    }

    const updated = await repository.save(repository.create({ ...existing, ...patch }));

    await this.audit.record(
      { ...auditActor, userId: actor.id, businessId: updated.businessId, branchId: null },
      {
        action: AuditAction.SUPPLIER_UPDATED,
        resourceType: AuditResourceType.SUPPLIER,
        resourceId: updated.id,
        oldValues: this.toResponse(existing) as unknown as Record<string, unknown>,
        newValues: this.toResponse(updated) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return updated;
  }

  private requireBusinessId(actor: AuthenticatedUser): string {
    if (!actor.businessId) {
      throw apiError(
        ErrorCode.VALIDATION_ERROR,
        'A business context is required to manage suppliers.',
        [{ field: 'businessId', message: 'no business is associated with your account' }],
      );
    }
    return actor.businessId;
  }
}
