import { User } from '../entities/user.entity';

/** The only user fields an admin write is allowed to change. */
export type UserPatch = Omit<
  Partial<User>,
  'id' | 'email' | 'role' | 'businessId' | 'passwordHash' | 'createdAt' | 'updatedAt'
>;
