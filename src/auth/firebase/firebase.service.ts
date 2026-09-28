import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth, type UserRecord } from 'firebase-admin/auth';
import { requireConfig } from '../../common/config';
import { FirebaseAuthTokensDto, FirebaseGoogleSignInDto } from '../dto';
import { firebaseErrorCode } from './firebase.errors';

const IDENTITY_TOOLKIT_URL = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1';
const DEFAULT_EXPIRES_IN = '3600';

@Injectable()
export class FirebaseService {
  readonly auth: Auth;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    const projectId = requireConfig(config, 'FIREBASE_PROJECT_ID');
    const clientEmail = requireConfig(config, 'FIREBASE_CLIENT_EMAIL');
    const privateKey = requireConfig(config, 'FIREBASE_PRIVATE_KEY').replace(
      /\\n/g,
      '\n',
    );
    this.apiKey = requireConfig(config, 'FIREBASE_API_KEY');

    const app =
      getApps()[0] ??
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
    this.auth = getAuth(app);
  }

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<FirebaseAuthTokensDto> {
    const fallback = new UnauthorizedException('Invalid email or password');
    const body = await this.postToGoogle<Partial<FirebaseAuthTokensDto>>(
      `${IDENTITY_TOOLKIT_URL}/accounts:signInWithPassword`,
      { email, password, returnSecureToken: true },
    );

    if (!body.idToken || !body.refreshToken || !body.localId) {
      throw fallback;
    }
    return {
      idToken: body.idToken,
      refreshToken: body.refreshToken,
      localId: body.localId,
      expiresIn: body.expiresIn ?? DEFAULT_EXPIRES_IN,
    };
  }

  /**
   * Exchanges a Google ID token for a Firebase session, creating the Firebase
   * account on first use. Firebase links it to an existing account with the
   * same email, so a password user signing in with Google keeps their uid.
   */
  async signInWithGoogle(
    googleIdToken: string,
  ): Promise<FirebaseGoogleSignInDto> {
    const fallback = new UnauthorizedException('Invalid Google credential');
    const body = await this.postToGoogle<
      Partial<FirebaseGoogleSignInDto> & { displayName?: string }
    >(`${IDENTITY_TOOLKIT_URL}/accounts:signInWithIdp`, {
      postBody: new URLSearchParams({
        id_token: googleIdToken,
        providerId: 'google.com',
      }).toString(),
      // Required, but only used by redirect flows; an ID token never redirects.
      requestUri: 'http://localhost',
      returnSecureToken: true,
    });

    if (!body.idToken || !body.refreshToken || !body.localId || !body.email) {
      throw fallback;
    }
    return {
      idToken: body.idToken,
      refreshToken: body.refreshToken,
      localId: body.localId,
      expiresIn: body.expiresIn ?? DEFAULT_EXPIRES_IN,
      email: body.email,
      emailVerified: body.emailVerified ?? false,
      // Google accounts may have only a display name, or a single name.
      firstName: body.firstName ?? body.displayName ?? '',
      lastName: body.lastName ?? '',
      isNewUser: body.isNewUser ?? false,
    };
  }

  async refreshIdToken(refreshToken: string): Promise<FirebaseAuthTokensDto> {
    const fallback = new UnauthorizedException(
      'Invalid or expired refresh token',
    );
    const body = await this.postToGoogle<{
      id_token?: string;
      refresh_token?: string;
      user_id?: string;
      expires_in?: string;
    }>(
      `${SECURE_TOKEN_URL}/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    );

    if (!body.id_token || !body.refresh_token || !body.user_id) {
      throw fallback;
    }
    return {
      idToken: body.id_token,
      refreshToken: body.refresh_token,
      localId: body.user_id,
      expiresIn: body.expires_in ?? DEFAULT_EXPIRES_IN,
    };
  }

  /** The Firebase account for an email, or `null` when there is none. */
  getUserByEmail(email: string): Promise<UserRecord | null> {
    return this.nullIfUserNotFound(() => this.auth.getUserByEmail(email));
  }

  /** A password-reset action link, or `null` when no account has the email. */
  generatePasswordResetLink(email: string): Promise<string | null> {
    return this.nullIfUserNotFound(() =>
      this.auth.generatePasswordResetLink(email),
    );
  }

  async confirmPasswordReset(
    oobCode: string,
    newPassword: string,
  ): Promise<string> {
    const fallback = new BadRequestException('Invalid or expired reset code');
    const body = await this.postToGoogle<{ email?: string }>(
      `${IDENTITY_TOOLKIT_URL}/accounts:resetPassword`,
      { oobCode, newPassword },
    );

    if (!body.email) {
      throw fallback;
    }
    return body.email;
  }

  private async nullIfUserNotFound<T>(
    lookup: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await lookup();
    } catch (error) {
      if (firebaseErrorCode(error) === 'auth/user-not-found') {
        return null;
      }
      throw error;
    }
  }

  private async postToGoogle<TBody>(
    url: string,
    payload: Record<string, unknown> | URLSearchParams,
  ): Promise<TBody> {
    const isForm = payload instanceof URLSearchParams;
    const response = await fetch(`${url}?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': isForm
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
      },
      body: isForm ? payload : JSON.stringify(payload),
    });

    const body = (await response.json()) as TBody & {
      error?: { message?: string };
    };
    if (!response.ok) {
      throw this.mapGoogleError(body.error?.message);
    }
    return body;
  }

  private mapGoogleError(message: string | undefined): Error {
    // Some errors carry a detail suffix, e.g. "INVALID_IDP_RESPONSE : ...".
    switch (message?.split(' : ')[0]) {
      case 'EMAIL_NOT_FOUND':
      case 'INVALID_PASSWORD':
      case 'INVALID_LOGIN_CREDENTIALS':
      case 'USER_DISABLED':
        return new UnauthorizedException('Invalid email or password');
      case 'INVALID_IDP_RESPONSE':
        return new UnauthorizedException('Invalid Google credential');
      case 'INVALID_REFRESH_TOKEN':
      case 'TOKEN_EXPIRED':
        return new UnauthorizedException('Invalid or expired refresh token');
      case 'TOO_MANY_ATTEMPTS_TRY_LATER':
        return new HttpException(
          'Too many attempts. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'INVALID_OOB_CODE':
      case 'EXPIRED_OOB_CODE':
        return new BadRequestException('Invalid or expired reset code');
      case 'WEAK_PASSWORD':
        return new BadRequestException(
          'Password should be at least 6 characters',
        );
      default:
        return new Error(`Google auth call failed: ${message ?? 'unknown'}`);
    }
  }
}
