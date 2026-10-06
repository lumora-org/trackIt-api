import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { Branch } from './entities/branch.entity';
import { CreateBranchDto, ListBranchesQueryDto, UpdateBranchDto } from './dto/branch.dto';
import { BranchResponseDto } from './dto/branch-response.dto';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch)
    private readonly repository: Repository<Branch>,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  toResponse(branch: Branch): BranchResponseDto {
    return {
      id: branch.id,
      businessId: branch.businessId,
      name: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone,
      status: branch.status,
    };
  }

  /**
   * Scoped listing (docs/04 §21.1): an ADMIN sees its own business, a MANAGER
   * sees only the branch assigned to them, SUPER_ADMIN sees all. A `branchId`
   * filter is clamped to the caller's scope rather than trusted.
   */
  async findAll(
    query: ListBranchesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<BranchResponseDto>> {
    // A SUPER_ADMIN may scope the list to one business; others are clamped
    // to their own (doc 04 §21.1).
    const businessId = this.authorization.resolveBusinessScope(actor, query.businessId ?? null);
    const forcedBranchId = this.authorization.resolveBranchScope(actor);

    const builder = this.repository
      .createQueryBuilder('branch')
      .where('branch.deleted_at IS NULL')
      .orderBy('branch.name', 'ASC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('branch.business_id = :businessId', { businessId });

    // A MANAGER is pinned to their own branch no matter what they asked for.
    if (forcedBranchId) {
      builder.andWhere('branch.id = :forcedBranchId', { forcedBranchId });
    }

    if (query.search) {
      builder.andWhere('(branch.name ILIKE :search OR branch.code ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    if (query.status) builder.andWhere('branch.status = :status', { status: query.status });

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  /** Resolves a branch id inside the caller's scope, or throws. */
  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<Branch> {
    const branch = await this.repository.findOne({ where: { id } });
    if (!branch) throw notFound('The requested branch was not found.');

    this.authorization.assertBusinessAccess(actor, branch.businessId);
    this.authorization.assertBranchAccess(actor, branch.id);

    return branch;
  }

  /**
   * Branches the caller may operate on — backs the frontend branch switcher
   * (PROMPT-B.E §4.17).
   */
  async findOperableByActor(actor: AuthenticatedUser): Promise<BranchResponseDto[]> {
    const businessId = this.authorization.resolveBusinessScope(actor);

    const builder = this.repository
      .createQueryBuilder('branch')
      .where('branch.deleted_at IS NULL')
      .orderBy('branch.name', 'ASC');

    if (businessId) builder.andWhere('branch.business_id = :businessId', { businessId });

    // Managers see exactly one branch, theirs.
    if (actor.role === UserRole.MANAGER && actor.branchId) {
      builder.andWhere('branch.id = :branchId', { branchId: actor.branchId });
    }

    const items = await builder.getMany();
    return items.map((item) => this.toResponse(item));
  }

  async create(
    dto: CreateBranchDto,
    actor: AuthenticatedUser,
    auditActor: { userId?: string | null; ipAddress?: string | null; userAgent?: string | null },
    manager?: EntityManager,
  ): Promise<Branch> {
    // The business always comes from the token for an ADMIN; a SUPER_ADMIN has
    // none of their own so the target must be named explicitly (docs/06 §32).
    const businessId = this.resolveTargetBusinessId(dto.businessId, actor);

    const repository = manager ? manager.getRepository(Branch) : this.repository;

    const branch = repository.create({
      businessId,
      name: dto.name.trim(),
      code: dto.code,
      address: dto.address.trim(),
      phone: dto.phone?.trim() ?? null,
    });

    const saved = await repository.save(branch);

    await this.audit.record(
      { ...auditActor, businessId, branchId: saved.id },
      {
        action: AuditAction.BRANCH_CREATED,
        resourceType: AuditResourceType.BRANCH,
        resourceId: saved.id,
        newValues: this.toResponse(saved) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdateBranchDto,
    actor: AuthenticatedUser,
    auditActor: { userId?: string | null; ipAddress?: string | null; userAgent?: string | null },
    manager?: EntityManager,
  ): Promise<Branch> {
    const existing = await this.findOneOrFail(id, actor);
    const repository = manager ? manager.getRepository(Branch) : this.repository;

    const patch: Partial<Branch> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.address !== undefined) patch.address = dto.address.trim();
    if (dto.phone !== undefined) patch.phone = dto.phone?.trim() ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) {
      throw invalidOperation('No supported changes were supplied.');
    }

    const updated = await repository.save(repository.create({ ...existing, ...patch }));

    await this.audit.record(
      { ...auditActor, businessId: updated.businessId, branchId: updated.id },
      {
        action: AuditAction.BRANCH_UPDATED,
        resourceType: AuditResourceType.BRANCH,
        resourceId: updated.id,
        oldValues: this.toResponse(existing) as unknown as Record<string, unknown>,
        newValues: this.toResponse(updated) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return updated;
  }

  /**
   * Used by other modules to validate a branch reference without leaking a
   * cross-tenant 404.
   */
  async requireBranchInBusiness(id: string, businessId: string): Promise<Branch> {
    const branch = await this.repository.findOne({ where: { id } });

    if (!branch || branch.businessId !== businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'The requested branch is not available.');
    }

    return branch;
  }

  private resolveTargetBusinessId(requested: string | undefined, actor: AuthenticatedUser): string {
    if (actor.role === UserRole.SUPER_ADMIN) {
      if (!requested) {
        throw apiError(
          ErrorCode.VALIDATION_ERROR,
          'businessId is required when creating a branch as SUPER_ADMIN.',
          [{ field: 'businessId', message: 'businessId is required for SUPER_ADMIN' }],
        );
      }
      return requested;
    }

    if (!actor.businessId) {
      throw apiError(
        ErrorCode.BUSINESS_ACCESS_DENIED,
        'No business is associated with your account.',
      );
    }

    // An ADMIN cannot plant another business id in the body.
    if (requested && requested !== actor.businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'You may only manage your own business.');
    }

    return actor.businessId;
  }
}
