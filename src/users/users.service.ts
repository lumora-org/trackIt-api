import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AccountStatus } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { notFound } from '../common/errors/api-exception';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { User } from './entities/user.entity';
import { UsersRepository } from './users.repository';

/**
 * Identity lookups plus the password-reset token lifecycle. The CRUD surface for
 * managers and admins arrives with the users module commit.
 *
 * This service deliberately holds no hashing logic: `PasswordService` and
 * `TokenService` live in the auth module, and having users depend on auth would
 * create a users → auth → users cycle (docs/05 §25). Callers pass hashes in.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokens: Repository<PasswordResetToken>,
  ) {}

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

  /** Loads a user who is allowed to hold a session. */
  async getAuthenticatableOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw notFound('The requested user was not found.');
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

  async recordLogin(userId: string): Promise<void> {
    await this.users.update(userId, { lastLoginAt: new Date() });
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.users.update(userId, { passwordHash });
  }

  /** Loads, applies a patch and persists — always inside a transaction. */
  async patchUser(userId: string, patch: Partial<User>, manager?: EntityManager): Promise<User> {
    return this.users.patch(userId, patch, manager);
  }

  /**
   * Records a single-use reset token, storing only its hash. The raw token is
   * returned so the caller can email it; nothing else ever sees it.
   */
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

  /** Invalidates any outstanding reset links for this account. */
  async invalidatePasswordResetTokens(userId: string): Promise<void> {
    await this.resetTokens
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('used_at IS NULL')
      .execute();
  }

  canAuthenticate(user: User): boolean {
    return user.status === AccountStatus.ACTIVE;
  }
}
