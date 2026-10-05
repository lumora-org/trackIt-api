/** Minimal audit-actor shape shared by services that do not want a Request. */
export interface AuditActorLike {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}
