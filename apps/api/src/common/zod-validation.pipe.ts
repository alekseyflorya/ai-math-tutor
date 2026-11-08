import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates request bodies with the same zod schemas the web app uses
 * (from @tutor/shared), so client and server can never disagree on a contract.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
        .join('; ');
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message });
    }
    return result.data;
  }
}
