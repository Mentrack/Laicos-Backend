import {
  BadRequestException,
  createParamDecorator,
  ParseUUIDPipe,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

/** The raw `Idempotency-Key` header; pair it with idempotencyKeyPipe(). */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Request>().header('idempotency-key'),
);

// ParseUUIDPipe's own messages ("The value passed as UUID is not a string")
// don't say which header is wrong.
export function idempotencyKeyPipe() {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      new BadRequestException({
        message: 'Idempotency-Key header must be a UUID',
        code: 'INVALID_IDEMPOTENCY_KEY',
      }),
  });
}
