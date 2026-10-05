import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../enums/user-role.enum';

export const ROLES_KEY = 'trackit:roles';

/**
 * Restricts a route to the listed roles (docs/06 §24). This is only the second
 * of five authorization layers — business and branch isolation still apply.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
