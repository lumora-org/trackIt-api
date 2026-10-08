export enum DailyReportStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Incident reports are the branch's free-text exception log (product decision,
 * 2026-10): stock variances, government vehicles collecting fuel without
 * paying, equipment failures — anything that explains why the numbers are not
 * what head office would expect. OPEN until an admin acknowledges it.
 */
export enum IncidentStatus {
  OPEN = 'OPEN',
  REVIEWED = 'REVIEWED',
}
