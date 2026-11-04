import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../authenticated-request';
import { AllowPendingApplication } from '../decorators/allow-pending-application.decorator';
import {
  applicationPendingError,
  isPendingActivation,
  verificationPendingError,
} from '../utils/pending-access';
import {
  emailNotVerifiedError,
  needsEmailVerification,
} from '../utils/email-verification';

/**
 * Buyers and riders must verify their email. An onboarded farmer is locked
 * out until their invite. A self-signup farmer or agent can sign in first:
 * until approval, only routes marked `@AllowPendingApplication()` answer.
 * Needs `req.user`, so it runs after `RequireLocalUserGuard`.
 */
@Injectable()
export class ActivationGuard implements CanActivate {
  constructor(
    private readonly database: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (needsEmailVerification(user)) {
      throw emailNotVerifiedError();
    }
    if (!isPendingActivation(user)) {
      return true;
    }
    const application = await this.database.application.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!application) {
      throw verificationPendingError(user.role);
    }
    if (!user.isVerified) {
      throw emailNotVerifiedError();
    }
    const allowed = this.reflector.getAllAndOverride(AllowPendingApplication, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }
    throw applicationPendingError();
  }
}
