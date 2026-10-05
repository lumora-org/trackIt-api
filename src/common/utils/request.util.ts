import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { AuditActor } from '../../audit-logs/audit-logs.service';

/**
 * Pulls the caller's IP and user-agent for audit rows. Trusts `x-forwarded-for`
 * only as the left-most hop, which is the proxy the app is deployed behind.
 */
export function extractSessionMetadata(req?: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  if (!req) return { ipAddress: null, userAgent: null };

  const forwarded = req.headers['x-forwarded-for'];
  const ipAddress =
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ?? req.ip ?? null;

  const userAgent =
    (typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null) ?? null;

  return { ipAddress, userAgent };
}

/** Builds the audit actor for a request that may or may not be authenticated. */
export function auditActorFromRequest(
  req: Request,
  overrides: Partial<AuditActor> = {},
): AuditActor {
  const { ipAddress, userAgent } = extractSessionMetadata(req);
  const user = (req as Request & { user?: AuthenticatedUser }).user;

  return {
    userId: user?.id ?? null,
    role: user?.role ?? null,
    businessId: user?.businessId ?? null,
    branchId: user?.branchId ?? null,
    ipAddress,
    userAgent,
    ...overrides,
  };
}
