import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../authenticated-request';
import { FirebaseService } from '../firebase/firebase.service';
import { verifySessionToken } from '../utils/session';

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

    request.firebaseUser = await verifySessionToken(this.firebase, token);
    return true;
  }
}
