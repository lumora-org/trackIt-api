import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AccountStatus } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { FuelType } from './entities/fuel-type.entity';
import { CreateFuelTypeDto, ListFuelTypesQueryDto, UpdateFuelTypeDto } from './dto/fuel-type.dto';
import { FuelTypeResponseDto } from './dto/fuel-type-response.dto';

export interface AuditActorLike {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class FuelTypesService {
  constructor(
    @InjectRepository(FuelType)
    private readonly repository: Repository<FuelType>,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  toResponse(fuelType: FuelType): FuelTypeResponseDto {
    return {
      id: fuelType.id,
      name: fuelType.name,
      code: fuelType.code,
      description: fuelType.description,
      status: fuelType.status,
    };
  }

  /** Fuel types are business-scoped, so the list is always filtered. */
  async findAll(
    query: ListFuelTypesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<FuelTypeResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);

    const builder = this.repository
      .createQueryBuilder('fuelType')
      .where('fuelType.deleted_at IS NULL')
      .orderBy('fuelType.name', 'ASC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('fuelType.business_id = :businessId', { businessId });

    if (query.search) {
      builder.andWhere('(fuelType.name ILIKE :search OR fuelType.code ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    if (query.status) builder.andWhere('fuelType.status = :status', { status: query.status });

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<FuelType> {
    const fuelType = await this.repository.findOne({ where: { id } });
    if (!fuelType) throw notFound('The requested fuel type was not found.');

    this.authorization.assertBusinessAccess(actor, fuelType.businessId);
    return fuelType;
  }

  /**
   * Resolves a fuel type for an operational write (sale, order, price).
   * INACTIVE fuel types are refused so a retired grade cannot take new
   * business, while historical rows remain readable (docs/08 §8).
   */
  async requireUsableFuelType(
    id: string,
    businessId: string,
    manager?: EntityManager,
  ): Promise<FuelType> {
    const repository = manager ? manager.getRepository(FuelType) : this.repository;
    const fuelType = await repository.findOne({ where: { id } });

    if (!fuelType || fuelType.businessId !== businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'The selected fuel type is not available.');
    }

    if (fuelType.status !== AccountStatus.ACTIVE) {
      throw invalidOperation(`Fuel type ${fuelType.code} is not active.`);
    }

    return fuelType;
  }

  async create(
    dto: CreateFuelTypeDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
    manager?: EntityManager,
  ): Promise<FuelType> {
    const businessId = this.resolveBusinessId(actor);
    const repository = manager ? manager.getRepository(FuelType) : this.repository;

    const created = repository.create({
      businessId,
      name: dto.name.trim(),
      code: dto.code,
      description: dto.description?.trim() ?? null,
      status: AccountStatus.ACTIVE,
    });

    const saved = await repository.save(created);

    await this.audit.record(
      { ...auditActor, userId: actor.id, businessId, branchId: null },
      {
        action: AuditAction.FUEL_TYPE_CREATED,
        resourceType: AuditResourceType.FUEL_TYPE,
        resourceId: saved.id,
        newValues: this.toResponse(saved) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdateFuelTypeDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
    manager?: EntityManager,
  ): Promise<FuelType> {
    const existing = await this.findOneOrFail(id, actor);
    const repository = manager ? manager.getRepository(FuelType) : this.repository;

    const patch: Partial<FuelType> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined) patch.description = dto.description?.trim() ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) {
      throw invalidOperation('No supported changes were supplied.');
    }

    // `code` is intentionally never patched: historical orders, sales and prices
    // reference it (docs/08 §13).
    const updated = await repository.save(repository.create({ ...existing, ...patch }));

    await this.audit.record(
      { ...auditActor, userId: actor.id, businessId: updated.businessId, branchId: null },
      {
        action: AuditAction.FUEL_TYPE_UPDATED,
        resourceType: AuditResourceType.FUEL_TYPE,
        resourceId: updated.id,
        oldValues: this.toResponse(existing) as unknown as Record<string, unknown>,
        newValues: this.toResponse(updated) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return updated;
  }

  /** A SUPER_ADMIN must name the target business; everyone else uses their own. */
  private resolveBusinessId(actor: AuthenticatedUser): string {
    if (!actor.businessId) {
      throw apiError(
        ErrorCode.VALIDATION_ERROR,
        'businessId is required when managing fuel types as SUPER_ADMIN.',
        [{ field: 'businessId', message: 'businessId is required for SUPER_ADMIN' }],
      );
    }
    return actor.businessId;
  }
}
