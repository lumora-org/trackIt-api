import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AccountStatus, UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { User } from './entities/user.entity';
import { UsersRepository } from './users.repository';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { Branch } from '../branches/entities/branch.entity';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { PasswordService } from '../auth/services/password.service';
import { TokenService } from '../auth/services/token.service';
import { UserPatch } from './interfaces/user-patch.interface';

/**
 * Identity lookups, user administration and the password-reset token
 * lifecycle.
 *
 * Hashing is injected rather than imported from the auth module's services in
 * the identity methods, but the admin write paths below deliberately need it,
 * so UsersModule imports AuthModule. Nest resolves this lazily via
 * forwardRef and the resulting cycle users <-> auth carries no initialisation
 * hazard because neither module's provider reads the other at construction.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokens: Repository<PasswordResetToken>,
    @InjectRepository(Branch)
    private readonly branches: Repository<Branch>,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  // ── Identity ──────────────────────────────────────────────────────────────

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  async getByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('The requested user was not found.');
    return user;
  }

  existsByEmail(email: string, exceptId?: string): Promise<boolean> {
    return this.users.existsByEmail(email, exceptId);
  }

  /**
   * Projects a user into the wire-safe identity shape. Deliberately omits the
   * password hash and every other internal field (PROMPT.md §45).
   */
  toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      businessId: user.businessId,
      branchId: user.branchId,
    };
  }

  toResponse(user: User): UserResponseDto {
    return { ...this.toAuthenticatedUser(user), lastLoginAt: user.lastLoginAt };
  }

  async recordLogin(userId: string): Promise<void> {
    await this.users.update(userId, { lastLoginAt: new Date() });
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.users.update(userId, { passwordHash });
  }

  canAuthenticate(user: User): boolean {
    return user.status === AccountStatus.ACTIVE;
  }

  // ── Password reset tokens ─────────────────────────────────────────────────

  /** Records a single-use reset token, storing only its hash. */
  async createPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.resetTokens.save(
      this.resetTokens.create({ userId, tokenHash, expiresAt, usedAt: null }),
    );
  }

  /** Consumes a reset token: valid, unexpired and unused, or null. */
  async consumePasswordResetToken(tokenHash: string): Promise<User | null> {
    const record = await this.resetTokens.findOne({ where: { tokenHash, usedAt: IsNull() } });
    if (!record) return null;
    if (record.expiresAt.getTime() <= Date.now()) return null;

    await this.resetTokens.update(record.id, { usedAt: new Date() });
    return this.findById(record.userId);
  }

  async invalidatePasswordResetTokens(userId: string): Promise<void> {
    await this.resetTokens
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('used_at IS NULL')
      .execute();
  }

  // ── Administration ────────────────────────────────────────────────────────

  /** ADMIN sees only its own business; SUPER_ADMIN sees all (docs/07 §57). */
  async findAll(
    query: ListUsersQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<UserResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);

    const builder = this.users
      .raw()
      .createQueryBuilder('user')
      .where('user.deleted_at IS NULL')
      .orderBy('user.created_at', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('user.business_id = :businessId', { businessId });

    if (query.search) {
      builder.andWhere(
        '(user.first_name ILIKE :search OR user.last_name ILIKE :search OR user.email ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.role) builder.andWhere('user.role = :role', { role: query.role });
    if (query.status) builder.andWhere('user.status = :status', { status: query.status });

    // A manager branch filter can never widen scope, only narrow within it.
    if (query.branchId) {
      builder.andWhere('user.branch_id = :branchId', { branchId: query.branchId });
    }

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findOneScopedOrFail(id: string, actor: AuthenticatedUser): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw notFound('The requested user was not found.');

    if (actor.role === UserRole.SUPER_ADMIN) return user;

    // ADMIN may only read users inside its own business.
    if (user.businessId !== actor.businessId) {
      throw notFound('The requested user was not found.');
    }

    return user;
  }

  /**
   * Creates a MANAGER or ADMIN. The business is derived from the caller, never
   * accepted from the body for an ADMIN (docs/07 §27, docs/06 §31).
   */
  async create(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
    auditActor: { userId?: string | null; ipAddress?: string | null; userAgent?: string | null },
    manager?: EntityManager,
  ): Promise<User> {
    const businessId = this.resolveTargetBusinessId(dto.businessId, actor);
    const branchId = await this.resolveBranchForNewUser(dto.role, dto.branchId, businessId);

    await this.assertEmailAvailable(dto.email);

    const repository = manager ? manager.getRepository(User) : this.users.raw();

    const created = repository.create({
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: dto.email,
      phone: dto.phone?.trim() ?? null,
      role: dto.role,
      status: AccountStatus.ACTIVE,
      businessId,
      branchId,
      passwordHash: await this.passwordService.hash(dto.password),
    });

    const saved = await repository.save(created);

    await this.audit.record(
      { ...auditActor, businessId, branchId },
      {
        action: AuditAction.USER_CREATED,
        resourceType: AuditResourceType.USER,
        resourceId: saved.id,
        // The password is deliberately absent from the audit payload.
        newValues: this.toResponse(saved) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
    auditActor: { userId?: string | null; ipAddress?: string | null; userAgent?: string | null },
    manager?: EntityManager,
  ): Promise<User> {
    const existing = await this.assertCanManage(actor, id);

    const patch: UserPatch = {};
    if (dto.firstName !== undefined) patch.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) patch.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) patch.phone = dto.phone?.trim() ?? null;

    if (dto.branchId !== undefined) {
      // Reassignment is only meaningful for a MANAGER, and the new branch must
      // sit inside the same business (docs/06 §35).
      if (existing.role !== UserRole.MANAGER) {
        throw invalidOperation('Only a manager can be assigned to a branch.');
      }
      if (!existing.businessId) {
        throw invalidOperation('This user is not associated with a business.');
      }
      await this.requireBranchInBusiness(dto.branchId, existing.businessId);
      patch.branchId = dto.branchId;
    }

    if (Object.keys(patch).length === 0) {
      throw invalidOperation('No supported changes were supplied.');
    }

    const updated = await this.users.patch(id, patch, manager);

    await this.audit.record(
      { ...auditActor, businessId: updated.businessId, branchId: updated.branchId },
      {
        action: AuditAction.USER_UPDATED,
        resourceType: AuditResourceType.USER,
        resourceId: id,
        oldValues: this.toResponse(existing) as unknown as Record<string, unknown>,
        newValues: this.toResponse(updated) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return updated;
  }

  /**
   * Activates, deactivates or suspends an account. Leaving ACTIVE revokes every
   * session so a suspension takes effect immediately (docs/06 §15).
   */
  async updateStatus(
    id: string,
    status: AccountStatus,
    actor: AuthenticatedUser,
    auditActor: { userId?: string | null; ipAddress?: string | null; userAgent?: string | null },
    manager?: EntityManager,
  ): Promise<User> {
    const existing = await this.assertCanManage(actor, id);

    const updated = await this.users.patch(id, { status }, manager);

    if (status !== AccountStatus.ACTIVE) {
      await this.tokenService.revokeAllForUser(id);
    }

    await this.audit.record(
      { ...auditActor, businessId: updated.businessId, branchId: updated.branchId },
      {
        action: AuditAction.USER_DEACTIVATED,
        resourceType: AuditResourceType.USER,
        resourceId: id,
        oldValues: { status: existing.status },
        newValues: { status },
      },
      manager,
    );

    return updated;
  }

  /**
   * Soft removal. Suspension remains the recommended flow, but the Users page
   * exposes a Delete action so the route has to exist (PROMPT-B.E §4.4).
   */
  async remove(
    id: string,
    actor: AuthenticatedUser,
    auditActor: { userId?: string | null; ipAddress?: string | null; userAgent?: string | null },
    manager?: EntityManager,
  ): Promise<void> {
    const existing = await this.assertCanManage(actor, id);

    await this.tokenService.revokeAllForUser(id);
    await this.users.patch(id, { deletedAt: new Date(), status: AccountStatus.INACTIVE }, manager);

    await this.audit.record(
      { ...auditActor, businessId: existing.businessId, branchId: existing.branchId },
      {
        action: AuditAction.USER_DEACTIVATED,
        resourceType: AuditResourceType.USER,
        resourceId: id,
        metadata: { removal: 'soft_delete' },
      },
      manager,
    );
  }

  /** Avatar is a base64 data URL, or null to clear it. */
  async updateAvatar(
    userId: string,
    avatarUrl: string | null,
    manager?: EntityManager,
  ): Promise<User> {
    if (avatarUrl !== null && !AVATAR_DATA_URL_PATTERN.test(avatarUrl)) {
      throw apiError(
        ErrorCode.VALIDATION_ERROR,
        'avatarUrl must be a png, jpeg or webp data URL.',
        [
          {
            field: 'avatarUrl',
            message: 'avatarUrl must be a data:image/(png|jpeg|webp);base64,... URL',
          },
        ],
      );
    }

    return this.users.patch(userId, { avatarUrl }, manager);
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  /**
   * Shared guard for update / status / delete (PROMPT-B.E §4.4).
   *
   * Returns the target so the caller does not have to load it twice.
   */
  private async assertCanManage(actor: AuthenticatedUser, targetId: string): Promise<User> {
    // Nobody edits themselves through the admin endpoints — including an
    // ADMIN changing their own name, which would bypass the profile route.
    if (targetId === actor.id) {
      throw invalidOperation('You cannot modify your own account through this endpoint.');
    }

    const target = await this.findById(targetId);
    if (!target) throw notFound('The requested user was not found.');

    // The SUPER_ADMIN account is untouchable by everyone, including itself.
    if (target.role === UserRole.SUPER_ADMIN) {
      throw apiError(
        ErrorCode.BUSINESS_ACCESS_DENIED,
        'The super administrator account cannot be modified.',
      );
    }

    if (actor.role === UserRole.SUPER_ADMIN) return target;

    // An ADMIN may only manage MANAGERs inside its own business (docs/07 §57).
    if (target.businessId !== actor.businessId) {
      throw apiError(
        ErrorCode.BUSINESS_ACCESS_DENIED,
        'You may only manage users in your own business.',
      );
    }

    if (target.role !== UserRole.MANAGER) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'You may only manage manager accounts.');
    }

    return target;
  }

  private async assertEmailAvailable(email: string, exceptId?: string): Promise<void> {
    if (await this.existsByEmail(email, exceptId)) {
      throw apiError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'An account with that email address already exists.',
      );
    }
  }

  private async resolveBranchForNewUser(
    role: UserRole,
    requestedBranchId: string | undefined,
    businessId: string,
  ): Promise<string | null> {
    if (role === UserRole.MANAGER) {
      if (!requestedBranchId) {
        throw apiError(
          ErrorCode.VALIDATION_ERROR,
          'branchId is required when creating a manager.',
          [{ field: 'branchId', message: 'branchId is required for role MANAGER' }],
        );
      }
      await this.requireBranchInBusiness(requestedBranchId, businessId);
      return requestedBranchId;
    }

    // An ADMIN must not carry a branch: the DB CHECK would reject it anyway,
    // but a clear 400 is friendlier than a constraint violation.
    if (requestedBranchId) {
      throw invalidOperation('An admin account must not be assigned to a branch.');
    }

    return null;
  }

  private async requireBranchInBusiness(branchId: string, businessId: string): Promise<Branch> {
    const branch = await this.branches.findOne({ where: { id: branchId } });

    if (!branch || branch.businessId !== businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'The selected branch is not available.');
    }

    return branch;
  }

  private resolveTargetBusinessId(requested: string | undefined, actor: AuthenticatedUser): string {
    if (actor.role === UserRole.SUPER_ADMIN) {
      if (!requested) {
        throw apiError(
          ErrorCode.VALIDATION_ERROR,
          'businessId is required when creating a user as SUPER_ADMIN.',
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

    if (requested && requested !== actor.businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'You may only manage your own business.');
    }

    return actor.businessId;
  }
}

/** Accepted avatar formats, matching the frontend mock's validation. */
export const AVATAR_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/;
