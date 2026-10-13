import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../authenticated-request';
import { FirebaseService } from '../firebase/firebase.service';
import { ActivationGuard } from './activation.guard';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { PasswordChangeGuard } from './password-change.guard';
import { RequireLocalUserGuard } from './require-local-user.guard';

interface SyncOrAsyncGuard {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

/**
 * Lets a request with no Authorization header through as a guest; with one,
 * runs the same chain as `@Auth()`. A bad token still 401s rather than
 * quietly becoming a guest, so the client knows to refresh it.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly chain: SyncOrAsyncGuard[];

  constructor(
    firebase: FirebaseService,
    database: PrismaService,
    reflector: Reflector,
  ) {
    this.chain = [
      new FirebaseAuthGuard(firebase),
      new RequireLocalUserGuard(database),
      new ActivationGuard(),
      new PasswordChangeGuard(reflector),
    ];
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    if (request.headers?.authorization === undefined) {
      return true;
    }
    for (const guard of this.chain) {
      if (!(await guard.canActivate(context))) {
        return false;
      }
    }
    return true;
  }
}
