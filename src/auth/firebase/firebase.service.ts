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
import { firebaseErrorCode } from './firebase.errors';

export interface FirebaseAuthTokens {
  idToken: string;
  refreshToken: string;
  localId: string;
  expiresIn: string;
}

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
    // .env files can't hold real newlines, so the PEM arrives with literal \n.
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
  ): Promise<FirebaseAuthTokens> {
    const fallback = new UnauthorizedException('Invalid email or password');
    const body = await this.postToGoogle<Partial<FirebaseAuthTokens>>(
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

  async refreshIdToken(refreshToken: string): Promise<FirebaseAuthTokens> {
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

  /**
   * POSTs to a Google auth REST endpoint with the web API key. A JSON object
   * is sent as JSON, `URLSearchParams` as a form. A failed call becomes the
   * mapped HTTP exception, or a 500 when Google's error is unrecognised.
   */
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

  /**
   * Only a genuinely bad credential may be a 401: the webapp reads any 401 as
   * an expired session, refreshes, retries and then signs the user out.
   */
  private mapGoogleError(message: string | undefined): Error {
    switch (message) {
      case 'EMAIL_NOT_FOUND':
      case 'INVALID_PASSWORD':
      case 'INVALID_LOGIN_CREDENTIALS':
      case 'USER_DISABLED':
        return new UnauthorizedException('Invalid email or password');
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
        // Unrecognised means our fault (e.g. an invalid API key), so a logged
        // 500 rather than a 401 that sends the webapp into a sign-out loop.
        return new Error(`Google auth call failed: ${message ?? 'unknown'}`);
    }
  }
}
