import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../../../generated/client';
import type { AuthenticatedRequest } from '../authenticated-request';

/** The local user on an `@OptionalAuth` route, or null for a guest. */
export const OptionalUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User | null =>
    context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>().user ??
    null,
);
