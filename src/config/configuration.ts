import { registerAs } from '@nestjs/config';

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const toList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) return fallback;
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
};

/** Anything unrecognised falls back to `lax` rather than failing boot. */
const toSameSite = (value: string | undefined): 'lax' | 'strict' | 'none' => {
  const parsed = value?.trim().toLowerCase();
  return parsed === 'strict' || parsed === 'none' ? parsed : 'lax';
};

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 4000),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  corsOrigin: toList(process.env.CORS_ORIGIN, ['http://localhost:3000']),
  businessTimezone: process.env.BUSINESS_TIMEZONE ?? 'Africa/Lagos',
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: toInt(process.env.DATABASE_PORT, 5432),
  name: process.env.DATABASE_NAME ?? 'trackit',
  user: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? '',
  // Production must never rely on synchronize (docs/03 §98, PROMPT.md §6).
  synchronize: false,
  logging: toBool(process.env.DATABASE_LOGGING, false),
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  passwordResetExpiresIn: process.env.PASSWORD_RESET_EXPIRES_IN ?? '30m',
}));

export const cookieConfig = registerAs('cookie', () => ({
  refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'kby_refresh_token',
  refreshCookieSecure: toBool(
    process.env.REFRESH_COOKIE_SECURE,
    process.env.NODE_ENV === 'production',
  ),
  // `none` is needed when the frontend and API are hosted on different sites
  // (e.g. app.example.com + api.example.com) so the httpOnly refresh cookie
  // still round-trips on cross-site XHR; browsers require a secure cookie
  // alongside it. Same-host proxy deployments keep the safer `lax`.
  refreshCookieSameSite: toSameSite(process.env.REFRESH_COOKIE_SAMESITE),
  refreshCookiePath: '/',
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttlSeconds: toInt(process.env.THROTTLE_TTL_SECONDS, 60),
  limit: toInt(process.env.THROTTLE_LIMIT, 100),
  authLimit: toInt(process.env.AUTH_THROTTLE_LIMIT, 10),
}));

export const inventoryConfig = registerAs('inventory', () => ({
  lowStockThresholdLitres: process.env.LOW_INVENTORY_THRESHOLD_LITRES ?? '500',
}));

/**
 * Web Push (PWA alerts). Entirely optional: with no VAPID key pair the feature
 * switches itself off, the REST endpoints answer `enabled: false`, and no send
 * is ever attempted — so an environment that has not generated keys still
 * boots exactly as before.
 */
export const pushConfig = registerAs('push', () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? '';
  return {
    publicKey,
    privateKey,
    /** Both halves are needed; one alone is rejected at validation time. */
    enabled: publicKey !== '' && privateKey !== '',
    /** `mailto:` or `https:` contact URL — required by the VAPID spec. */
    subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:alerts@kbyglobal.example',
    maxSubscriptionsPerUser: toInt(process.env.PUSH_MAX_SUBSCRIPTIONS_PER_USER, 10),
    /** Seconds a message may sit queued at the push service before being dropped. */
    ttlSeconds: toInt(process.env.PUSH_TTL_SECONDS, 3600),
  };
});

export const configurations = [
  appConfig,
  databaseConfig,
  jwtConfig,
  cookieConfig,
  throttleConfig,
  inventoryConfig,
  pushConfig,
];

export type AppConfig = ReturnType<typeof appConfig>;
export type DatabaseConfig = ReturnType<typeof databaseConfig>;
export type JwtConfig = ReturnType<typeof jwtConfig>;
export type ThrottleConfig = ReturnType<typeof throttleConfig>;
