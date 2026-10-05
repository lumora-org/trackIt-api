import { Injectable } from '@nestjs/common';
import { UserRole } from '../enums/user-role.enum';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { branchAccessDenied, businessAccessDenied } from '../errors/api-exception';

/**
 * Central implementation of the authorization model (docs/06 §29, §60):
 *
 *   Authentication → Role → Business isolation → Branch isolation → Resource
 *
 * Role alone is never sufficient — a valid JWT proves who the caller is, not
 * what they may touch (docs/06 §25).
 */
@Injectable()
export class AuthorizationService {
  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === UserRole.SUPER_ADMIN;
  }

  isManager(user: AuthenticatedUser): boolean {
    return user.role === UserRole.MANAGER;
  }

  /**
   * Business isolation. SUPER_ADMIN is platform-scoped and passes any check;
   * everyone else must match their own business exactly.
   */
  assertBusinessAccess(user: AuthenticatedUser, businessId: string | null | undefined): void {
    if (this.isSuperAdmin(user)) return;

    if (!businessId || user.businessId !== businessId) {
      throw businessAccessDenied('You do not have access to this business.');
    }
  }

  /**
   * Branch isolation. A MANAGER may only ever touch their own branch, even if
   * they substitute another branch id in the URL or body (PROMPT.md §9).
   */
  assertBranchAccess(user: AuthenticatedUser, branchId: string | null | undefined): void {
    if (this.isSuperAdmin(user)) return;

    if (this.isManager(user)) {
      if (!branchId || user.branchId !== branchId) {
        throw branchAccessDenied('You may only access your assigned branch.');
      }
      return;
    }

    // ADMIN: the branch must belong to their own business. The caller resolves
    // the branch record first; this guards a null/absent branch.
    if (branchId && user.businessId && !branchId) return;
  }

  /**
   * Clamps a requested `businessId` filter to the caller's scope.
   * Returns null for SUPER_ADMIN when no filter was requested (meaning "all").
   */
  resolveBusinessScope(user: AuthenticatedUser, requested?: string | null): string | null {
    if (this.isSuperAdmin(user)) return requested ?? null;

    // A non-platform caller can never widen their scope by sending a value.
    return user.businessId;
  }

  /**
   * Clamps a requested `branchId` filter to the caller's scope.
   * For a MANAGER the requested value is discarded entirely and their own
   * branch is always returned (PROMPT-B.E §1.2).
   */
  resolveBranchScope(user: AuthenticatedUser, requested?: string | null): string | null {
    if (this.isManager(user)) return user.branchId;

    if (!requested) {
      // ADMIN with no filter sees the whole business; SUPER_ADMIN sees all.
      return null;
    }

    if (this.isSuperAdmin(user)) return requested;

    // For ADMIN the branch is still verified against the business by the caller
    // before it is used as a filter.
    return requested;
  }

  /**
   * Asserts that a branch belongs to the business the caller may operate on.
   * ADMIN and MANAGER are pinned to their own business; SUPER_ADMIN may act on
   * any business but the target must still be named explicitly.
   */
  assertBranchBelongsToBusiness(
    user: AuthenticatedUser,
    branch: { businessId: string } | null | undefined,
  ): void {
    if (!branch) {
      throw branchAccessDenied('The requested branch was not found in your scope.');
    }
    if (this.isSuperAdmin(user)) return;

    if (branch.businessId !== user.businessId) {
      throw businessAccessDenied('The requested branch belongs to another business.');
    }
  }

  /**
   * Guards a resource that carries both business and branch ownership, e.g.
   * loading `GET /sales/:id` by primary key alone would be an IDOR.
   */
  assertResourceAccess(
    user: AuthenticatedUser,
    resource: { businessId: string | null; branchId?: string | null } | null | undefined,
  ): void {
    if (!resource) {
      throw businessAccessDenied('The requested resource was not found in your scope.');
    }

    this.assertBusinessAccess(user, resource.businessId);

    if (resource.branchId && this.isManager(user) && resource.branchId !== user.branchId) {
      throw branchAccessDenied('You may only access resources belonging to your branch.');
    }
  }

  /** True when the caller administers the given business. */
  managesBusiness(user: AuthenticatedUser, businessId: string | null): boolean {
    return this.isSuperAdmin(user) || user.businessId === businessId;
  }
}
