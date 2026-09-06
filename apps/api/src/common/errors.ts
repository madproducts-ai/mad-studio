import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Typed application errors. Every error carries a stable machine-readable
 * `code` so the web client can branch on it without string-matching messages.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super('not_found', `${entity} ${id} was not found.`, HttpStatus.NOT_FOUND, { entity, id });
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('validation_failed', 'The request did not match the expected schema.', HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, HttpStatus.CONFLICT, details);
  }
}

export class StateError extends AppError {
  constructor(message: string, details?: unknown) {
    super('invalid_state', message, HttpStatus.BAD_REQUEST, details);
  }
}
