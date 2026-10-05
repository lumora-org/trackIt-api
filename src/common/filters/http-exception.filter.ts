import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ApiException } from '../errors/api-exception';
import { ApiErrorDetail, ErrorCode, ErrorCodeValue } from '../errors/error-codes';

interface ErrorBody {
  code: ErrorCodeValue;
  message: string;
  errors?: ApiErrorDetail[];
}

/** Postgres SQLSTATE codes we translate into meaningful 409s. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';
const PG_EXCLUSION_VIOLATION = '23P01';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const { status, body } = this.normalise(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Never leak stack traces to the client, but keep them in our own logs.
      this.logger.error(
        `Unhandled error on ${request?.method} ${request?.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      code: body.code,
      message: body.message,
      ...(body.errors?.length ? { errors: body.errors } : {}),
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
    });
  }

  private normalise(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof ApiException) {
      return {
        status: exception.getStatus(),
        body: {
          code: exception.code,
          message: exception.message,
          errors: exception.errors,
        },
      };
    }

    if (exception instanceof QueryFailedError) {
      return this.fromQueryFailure(exception);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { status, body: { code: this.codeFor(status), message: payload } };
      }

      const record = payload as { message?: string | string[]; errors?: ApiErrorDetail[] };
      const errors = record.errors ?? this.toDetails(record.message);
      const message = Array.isArray(record.message)
        ? 'Validation failed.'
        : (record.message ?? exception.message);

      return { status, body: { code: this.codeFor(status), message, errors } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred. Please try again later.',
      },
    };
  }

  /**
   * Turns PostgreSQL constraint violations into the documented codes rather
   * than leaking driver internals.
   */
  private fromQueryFailure(exception: QueryFailedError): { status: number; body: ErrorBody } {
    const driverError = exception.driverError as {
      code?: string;
      constraint?: string;
      detail?: string;
    };
    const constraint = driverError?.constraint ?? '';

    switch (driverError?.code) {
      case PG_UNIQUE_VIOLATION:
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: ErrorCode.RESOURCE_ALREADY_EXISTS,
            message: this.uniqueMessage(constraint),
          },
        };
      case PG_FOREIGN_KEY_VIOLATION:
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          body: {
            code: ErrorCode.INVALID_OPERATION,
            message: 'The operation references a record that does not exist.',
          },
        };
      case PG_CHECK_VIOLATION:
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          body: {
            code: ErrorCode.INVALID_OPERATION,
            message: 'The operation violates a data integrity rule.',
          },
        };
      case PG_EXCLUSION_VIOLATION:
        // Raised by the fuel-price interval exclusion constraint.
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          body: {
            code: ErrorCode.INVALID_FUEL_PRICE,
            message: 'The new price period overlaps an existing price period.',
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: {
            code: ErrorCode.INTERNAL_ERROR,
            message: 'An unexpected error occurred. Please try again later.',
          },
        };
    }
  }

  private uniqueMessage(constraint: string): string {
    if (constraint.includes('users_email')) {
      return 'An account with that email address already exists.';
    }
    if (constraint.includes('branches_business_id_code')) {
      return 'A branch with that code already exists in this business.';
    }
    if (constraint.includes('fuel_types_business_id_code')) {
      return 'A fuel type with that code already exists in this business.';
    }
    if (constraint.includes('suppliers_business_id_code')) {
      return 'A supplier with that code already exists in this business.';
    }
    if (constraint.includes('tankers_business_id_registration')) {
      return 'A tanker with that registration number already exists in this business.';
    }
    if (constraint.includes('daily_reports_branch_id_report_date')) {
      return 'A daily report already exists for this branch and date.';
    }
    if (constraint.includes('fuel_orders_business_id_order_number')) {
      return 'A fuel order with that order number already exists.';
    }
    if (constraint.includes('sales_business_id_sale_number')) {
      return 'A sale with that sale number already exists.';
    }
    if (constraint.includes('idempotency_keys_pkey')) {
      return 'This request has already been processed.';
    }
    return 'A record with those unique values already exists.';
  }

  private codeFor(status: number): ErrorCodeValue {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.AUTH_TOKEN_EXPIRED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.BUSINESS_ACCESS_DENIED;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.RESOURCE_ALREADY_EXISTS;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.INVALID_OPERATION;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }

  private toDetails(message?: string | string[]): ApiErrorDetail[] | undefined {
    if (!Array.isArray(message) || message.length === 0) return undefined;
    return message.map((entry) => {
      const [field, ...rest] = entry.split(' ');
      return { field, message: rest.length ? rest.join(' ') : entry };
    });
  }
}
