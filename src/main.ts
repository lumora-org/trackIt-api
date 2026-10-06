import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { VALIDATION_PIPE_OPTIONS } from './common/pipes/validation.pipe';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('app.env') === 'production';

  // Every documented endpoint (docs/04, docs/08, docs/09) lives under
  // /api/v1 — keep this in sync with the Swagger document and the frontend.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.use(
    helmet({
      // Production serves JSON and file downloads only, never HTML, so the
      // tightest policy applies. Non-production also serves the Swagger UI,
      // whose "Try it out" calls need connect-src (it falls back to
      // default-src, so 'none' blocks every request with "Failed to fetch")
      // and break under upgrade-insecure-requests (no TLS listener locally).
      contentSecurityPolicy: isProduction
        ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
        : {
            useDefaults: false,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              frameAncestors: ["'self'"],
            },
          },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  // The refresh cookie is cross-origin in development, so credentials are
  // required (PROMPT-B.E §2.1).
  app.enableCors({
    origin: config.getOrThrow<string[]>('app.corsOrigin'),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Requested-Refresh',
      'X-Request-ID',
    ],
    exposedHeaders: ['X-Request-ID', 'Content-Disposition'],
  });

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  app.enableShutdownHooks();

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('trackIt API')
      .setDescription(
        'K.B.Y GLOBAL INVESTMENT — multi-branch fuel station management backend. ' +
          'Business isolation, branch isolation, ledger-driven inventory and automatic ' +
          'revenue calculation are enforced server-side; the frontend is never trusted.',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addTag('auth', 'Authentication, sessions and password recovery')
      .addTag('businesses', 'Business accounts (SUPER_ADMIN)')
      .addTag('branches', 'Branch management')
      .addTag('users', 'User and manager accounts')
      .addTag('fuel-types', 'Fuel type catalogue')
      .addTag('fuel-prices', 'Time-interval fuel pricing')
      .addTag('suppliers', 'Supplier register')
      .addTag('tankers', 'Tanker fleet')
      .addTag('fuel-orders', 'Procurement commitments')
      .addTag('deliveries', 'Physical deliveries and receiving')
      .addTag('inventory', 'Inventory ledger and adjustments')
      .addTag('sales', 'Fuel sales and revenue')
      .addTag('daily-reports', 'Daily operational reports and approvals')
      .addTag('notifications', 'Per-user notifications')
      .addTag('dashboard', 'Aggregated operational dashboards')
      .addTag('reports', 'Operational reports and Excel export')
      .addTag('audit-logs', 'Append-only audit trail')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.getOrThrow<number>('app.port');
  await app.listen(port);

  Logger.log(`trackIt API listening on port ${port}`, 'Bootstrap');
  Logger.log(`API prefix: /api/v1`, 'Bootstrap');
}

void bootstrap();
