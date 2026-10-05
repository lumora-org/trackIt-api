import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';

/**
 * DataSource used by the TypeORM CLI (`npm run migration:run`). It reads the
 * same environment variables as the application so a migration can never be
 * applied to a different database than the app connects to.
 */
const isProduction = process.env.NODE_ENV === 'production';

export const AppDataSource = new DataSource({
  type: 'postgres',
  ...(process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : {
        host: process.env.DATABASE_HOST ?? 'localhost',
        port: Number(process.env.DATABASE_PORT ?? 5432),
        username: process.env.DATABASE_USER ?? 'postgres',
        password: process.env.DATABASE_PASSWORD ?? '',
        database: process.env.DATABASE_NAME ?? 'trackit',
      }),
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  entities: ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  // Never rely on synchronize for schema management (PROMPT.md §57).
  synchronize: false,
  migrationsRun: false,
  logging: process.env.DATABASE_LOGGING === 'true',
});

export default AppDataSource;
