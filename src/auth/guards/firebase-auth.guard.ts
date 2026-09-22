import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../authenticated-request';
import { FirebaseService } from '../firebase/firebase.service';

/** Verifies the bearer ID token and sets `req.firebaseUser`. */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    const [scheme, token] = request.headers?.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      // checkRevoked: logout revokes refresh tokens, and without this an
      // already-issued ID token would keep working until it expires.
      request.firebaseUser = await this.firebase.auth.verifyIdToken(
        token,
        true,
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}
