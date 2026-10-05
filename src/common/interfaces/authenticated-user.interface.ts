import { AccountStatus, UserRole } from '../enums/user-role.enum';

/**
 * The authoritative identity of the caller, derived exclusively from a verified
 * access token (docs/06 §51). `businessId`/`branchId` here — never a
 * client-supplied value — are what every scoping decision must use.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: AccountStatus;
  businessId: string | null;
  branchId: string | null;
}

export interface JwtPayload {
  sub: string;
  role: UserRole;
  businessId: string | null;
  branchId: string | null;
}

/** Roles that operate a platform rather than a single business. */
export const PLATFORM_ROLES: readonly UserRole[] = [UserRole.SUPER_ADMIN];
