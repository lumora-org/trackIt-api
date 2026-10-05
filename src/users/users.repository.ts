import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, UpdateResult } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  /**
   * Email lookup is case-insensitive. Uniqueness is enforced by a functional
   * index on LOWER(email), so the read path must match it exactly.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

  save(user: User): Promise<User> {
    return this.repository.save(user);
  }

  /** Escape hatch for services that need to join a transaction. */
  raw(): Repository<User> {
    return this.repository;
  }

  /** Loads, applies a patch and persists. */
  async patch(id: string, changes: Partial<User>, manager?: EntityManager): Promise<User> {
    const repository = manager ? manager.getRepository(User) : this.repository;
    await repository.update(id, changes);
    return repository.findOneByOrFail({ id });
  }

  update(id: string, patch: Partial<User>): Promise<UpdateResult> {
    return this.repository.update(id, patch);
  }

  existsByEmail(email: string, exceptId?: string): Promise<boolean> {
    const query = this.repository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() });

    if (exceptId) query.andWhere('user.id != :exceptId', { exceptId });

    return query.getExists();
  }
}
