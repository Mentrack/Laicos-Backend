import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../../../generated/client';
import type { AuthenticatedRequest } from '../authenticated-request';

/** The local user loaded by `@Auth`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
