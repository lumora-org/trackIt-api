import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorDetail, ERROR_HTTP_STATUS, ErrorCode, ErrorCodeValue } from './error-codes';

export interface ApiExceptionBody {
  code: ErrorCodeValue;
  message: string;
  errors?: ApiErrorDetail[];
}

/**
 * Every error leaving the API is an ApiException so the filter can emit the
 * single documented error shape (docs/04 §7, PROMPT-B.E §2.6).
 */
export class ApiException extends HttpException {
  readonly code: ErrorCodeValue;
  readonly errors?: ApiErrorDetail[];

  constructor(code: ErrorCodeValue, message: string, errors?: ApiErrorDetail[]) {
    super({ code, message, errors } satisfies ApiExceptionBody, ERROR_HTTP_STATUS[code]);
    this.code = code;
    this.errors = errors;
  }
}

export const apiError = (
  code: ErrorCodeValue,
  message: string,
  errors?: ApiErrorDetail[],
): ApiException => new ApiException(code, message, errors);

export const validationError = (message: string, errors?: ApiErrorDetail[]): ApiException =>
  apiError(ErrorCode.VALIDATION_ERROR, message, errors);

export const notFound = (message = 'The requested resource was not found.'): ApiException =>
  apiError(ErrorCode.RESOURCE_NOT_FOUND, message);

export const conflict = (
  message: string,
  code: ErrorCodeValue = ErrorCode.RESOURCE_ALREADY_EXISTS,
): ApiException => apiError(code, message);

export const businessAccessDenied = (
  message = 'You do not have access to this business.',
): ApiException => apiError(ErrorCode.BUSINESS_ACCESS_DENIED, message);

export const branchAccessDenied = (
  message = 'You do not have access to this branch.',
): ApiException => apiError(ErrorCode.BRANCH_ACCESS_DENIED, message);

export const invalidOperation = (message: string): ApiException =>
  apiError(ErrorCode.INVALID_OPERATION, message);

/** Convenience for framework exceptions we want re-framed as our own codes. */
export const httpStatusToCode = (status: number): ErrorCodeValue => {
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
};
