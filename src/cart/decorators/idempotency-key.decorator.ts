import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The raw `Idempotency-Key` header; pair it with ParseUUIDPipe. */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Request>().header('idempotency-key'),
);
