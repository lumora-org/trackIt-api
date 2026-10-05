import { ConfigService } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';
import { databaseConfig } from './configuration';

/**
 * Single source of truth for the TypeORM connection so the running app and the
 * migration CLI (`src/database/data-source.ts`) can never drift apart.
 */
export function buildDataSourceOptions(config: ConfigService): DataSourceOptions {
  const db = config.getOrThrow<ReturnType<typeof databaseConfig>>('database');
  const isProduction = config.get<string>('app.env') === 'production';

  const shared = {
    type: 'postgres' as const,
    // `synchronize` is forbidden in every environment: schema changes must go
    // through reviewed migrations (PROMPT.md §57).
    synchronize: false,
    migrationsRun: false,
    logging: db.logging,
    // NUMERIC must arrive as a string so decimal precision survives (docs/05 §27).
    extra: { max: 20 },
  };

  if (db.url) {
    return { ...shared, url: db.url };
  }

  return {
    ...shared,
    host: db.host,
    port: db.port,
    username: db.user,
    password: db.password,
    database: db.name,
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  };
}
