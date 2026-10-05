import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'trackit:idempotent';

/**
 * Marks a financially-sensitive write as requiring an `Idempotency-Key` header
 * so a retry or double-tap cannot duplicate the business effect
 * (PROMPT-B.E §2.5).
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
