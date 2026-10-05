import { ValidationError, ValidationPipeOptions } from '@nestjs/common';
import { ApiErrorDetail } from '../errors/error-codes';
import { ApiException, validationError } from '../errors/api-exception';
import { ErrorCode } from '../errors/error-codes';

/**
 * Flattens class-validator's nested error tree into dotted field paths so the
 * frontend can attach each message to the right form input
 * (e.g. `items.0.unitCost`) — PROMPT-B.E §2.6.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    // Nested objects and arrays produce `children`; recurse with the array index.
    if (error.children?.length) {
      error.children.forEach((child, index) => {
        const childPath =
          typeof child === 'object' && 'property' in child ? `${path}.${index}` : path;
        const asValidationError = child;
        details.push(...flattenValidationErrors([asValidationError], childPath));
      });
      continue;
    }

    const messages = error.constraints ? Object.values(error.constraints) : [];
    for (const message of messages) {
      details.push({ field: path, message });
    }
  }

  return details;
}

export function validationExceptionFactory(errors: ValidationError[]): ApiException {
  const details = flattenValidationErrors(errors);
  return validationError(details.length ? details[0].message : 'Validation failed.', details);
}

export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  stopAtFirstError: false,
  exceptionFactory: validationExceptionFactory,
};

export { ApiException, ErrorCode };
