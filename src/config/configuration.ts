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
  refreshCookieSameSite: 'lax' as const,
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

export const configurations = [
  appConfig,
  databaseConfig,
  jwtConfig,
  cookieConfig,
  throttleConfig,
  inventoryConfig,
];

export type AppConfig = ReturnType<typeof appConfig>;
export type DatabaseConfig = ReturnType<typeof databaseConfig>;
export type JwtConfig = ReturnType<typeof jwtConfig>;
export type ThrottleConfig = ReturnType<typeof throttleConfig>;
