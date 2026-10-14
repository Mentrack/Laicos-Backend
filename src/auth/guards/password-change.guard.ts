import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../authenticated-request';
import { AllowPendingPasswordChange } from '../decorators/allow-pending-password-change.decorator';
import { passwordChangeRequiredError } from '../utils/session';

/**
 * Holds a user on a temporary password (agent-onboarded farmers) to the
 * routes marked `@AllowPendingPasswordChange()` until they change it. Needs
 * `req.user`, so it runs after `RequireLocalUserGuard`.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user.mustChangePassword) {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride(
      AllowPendingPasswordChange,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) {
      return true;
    }
    throw passwordChangeRequiredError();
  }
}
