import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../authenticated-request';
import {
  isPendingActivation,
  verificationPendingError,
} from '../utils/pending-access';

/**
 * Locks a farmer or agent out until they are verified. Sign-in refuses them
 * too; this covers an ID token issued before that check existed or by the
 * client SDK directly. Needs `req.user`, so it runs after
 * `RequireLocalUserGuard`.
 */
@Injectable()
export class ActivationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (isPendingActivation(user)) {
      throw verificationPendingError(user.role);
    }
    return true;
  }
}
