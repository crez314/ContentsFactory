import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/** DTO 검증은 zod 스키마 하나로 통일한다 (§3.2 계약과 같은 도구를 쓴다). */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}
  transform(value: unknown, _meta: ArgumentMetadata): unknown {
    return this.schema.parse(value);
  }
}

export const zodBody = (schema: ZodSchema) => new ZodValidationPipe(schema);
