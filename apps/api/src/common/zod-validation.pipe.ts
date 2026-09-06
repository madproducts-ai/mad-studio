import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ValidationError } from './errors';

/**
 * Validates and *transforms* a body, query or param against a Zod schema.
 * Defaults declared in the schema are applied, so handlers receive the fully
 * resolved type rather than the raw wire shape.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

export const zodBody = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);
