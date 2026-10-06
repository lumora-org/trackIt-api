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
import { DecimalMath } from '../common/utils/money.util';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { Tanker } from './entities/tanker.entity';
import { CreateTankerDto, ListTankersQueryDto, UpdateTankerDto } from './dto/tanker.dto';
import { TankerResponseDto } from './dto/tanker-response.dto';

@Injectable()
export class TankersService {
  constructor(
    @InjectRepository(Tanker)
    private readonly repository: Repository<Tanker>,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  toResponse(tanker: Tanker): TankerResponseDto {
    return {
      id: tanker.id,
      businessId: tanker.businessId,
      registrationNumber: tanker.registrationNumber,
      tankerCode: tanker.tankerCode,
      capacityLitres: tanker.capacityLitres,
      driverName: tanker.driverName,
      driverPhone: tanker.driverPhone,
      status: tanker.status,
    };
  }

  async findAll(
    query: ListTankersQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<TankerResponseDto>> {
    // A SUPER_ADMIN may scope the list to one business; others are clamped
    // to their own.
    const businessId = this.authorization.resolveBusinessScope(actor, query.businessId ?? null);

    const builder = this.repository
      .createQueryBuilder('tanker')
      .where('tanker.deleted_at IS NULL')
      .orderBy('tanker.registration_number', 'ASC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('tanker.business_id = :businessId', { businessId });

    if (query.search) {
      builder.andWhere(
        '(tanker.registration_number ILIKE :search OR tanker.tanker_code ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.status) builder.andWhere('tanker.status = :status', { status: query.status });

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<Tanker> {
    const tanker = await this.repository.findOne({ where: { id } });
    if (!tanker) throw notFound('The requested tanker was not found.');

    this.authorization.assertBusinessAccess(actor, tanker.businessId);
    return tanker;
  }

  /** Tanker for a delivery: must exist, be in scope and be active. */
  async requireUsableTanker(
    id: string,
    businessId: string,
    manager?: EntityManager,
  ): Promise<Tanker> {
    const repository = manager ? manager.getRepository(Tanker) : this.repository;
    const tanker = await repository.findOne({ where: { id } });

    if (!tanker || tanker.businessId !== businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'The selected tanker is not available.');
    }

    if (tanker.status !== AccountStatus.ACTIVE) {
      throw invalidOperation(`Tanker ${tanker.registrationNumber} is not active.`);
    }

    return tanker;
  }

  /**
   * Warns when a load would exceed the tanker's capacity. docs/09 does not
   * specify a capacity rule at all, so this is surfaced as a caller-checkable
   * 422 rather than silently accepted.
   */
  assertWithinCapacity(tanker: Tanker, loadLitres: string): void {
    const capacity = DecimalMath.parse(tanker.capacityLitres);
    const load = DecimalMath.parse(loadLitres);

    if (DecimalMath.compare(load, capacity) > 0) {
      throw apiError(
        ErrorCode.INVALID_DELIVERY_QUANTITY,
        `The load exceeds the tanker capacity of ${tanker.capacityLitres} litres.`,
      );
    }
  }

  async create(
    dto: CreateTankerDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
    manager?: EntityManager,
  ): Promise<Tanker> {
    const businessId = this.requireBusinessId(actor);
    const repository = manager ? manager.getRepository(Tanker) : this.repository;

    const created = repository.create({
      businessId,
      registrationNumber: dto.registrationNumber,
      tankerCode: dto.tankerCode?.trim() ?? null,
      capacityLitres: DecimalMath.toFixedString(
        DecimalMath.rescale(DecimalMath.parse(dto.capacityLitres), DecimalMath.QUANTITY_SCALE),
        DecimalMath.QUANTITY_SCALE,
      ),
      driverName: dto.driverName?.trim() ?? null,
      driverPhone: dto.driverPhone?.trim() ?? null,
      status: AccountStatus.ACTIVE,
    });

    const saved = await repository.save(created);

    await this.audit.record(
      { ...auditActor, userId: actor.id, businessId, branchId: null },
      {
        action: AuditAction.TANKER_CREATED,
        resourceType: AuditResourceType.TANKER,
        resourceId: saved.id,
        newValues: this.toResponse(saved) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdateTankerDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
    manager?: EntityManager,
  ): Promise<Tanker> {
    const existing = await this.findOneOrFail(id, actor);
    const repository = manager ? manager.getRepository(Tanker) : this.repository;

    const patch: Partial<Tanker> = {};
    if (dto.registrationNumber !== undefined) patch.registrationNumber = dto.registrationNumber;
    if (dto.tankerCode !== undefined) patch.tankerCode = dto.tankerCode?.trim() ?? null;
    if (dto.driverName !== undefined) patch.driverName = dto.driverName?.trim() ?? null;
    if (dto.driverPhone !== undefined) patch.driverPhone = dto.driverPhone?.trim() ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (dto.capacityLitres !== undefined) {
      patch.capacityLitres = DecimalMath.toFixedString(
        DecimalMath.rescale(DecimalMath.parse(dto.capacityLitres), DecimalMath.QUANTITY_SCALE),
        DecimalMath.QUANTITY_SCALE,
      );
    }

    if (Object.keys(patch).length === 0) {
      throw invalidOperation('No supported changes were supplied.');
    }

    const updated = await repository.save(repository.create({ ...existing, ...patch }));

    await this.audit.record(
      { ...auditActor, userId: actor.id, businessId: updated.businessId, branchId: null },
      {
        action: AuditAction.TANKER_UPDATED,
        resourceType: AuditResourceType.TANKER,
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
        'A business context is required to manage tankers.',
        [{ field: 'businessId', message: 'no business is associated with your account' }],
      );
    }
    return actor.businessId;
  }
}
