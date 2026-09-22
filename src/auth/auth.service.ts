import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserRecord } from 'firebase-admin/auth';
import {
  RegisterDto,
  LoginDto,
  ChangePasswordDto,
  ConfirmForgotPasswordDto,
} from './dto';
import { firebaseErrorCode } from './firebase/firebase.errors';
import {
  FirebaseAuthTokens,
  FirebaseService,
} from './firebase/firebase.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role, type User as UserModel } from '../../generated/client';
import { isUniqueViolation } from '../common/prisma-errors';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const firebaseRecord = await this.createFirebaseUser(dto);
    try {
      return await this.completeRegistration(dto, firebaseRecord);
    } catch (error) {
      // Any later failure must undo both accounts; a half-registered user
      // gets "Account already registered" on every retry.
      await this.database.user
        .deleteMany({ where: { firebaseUid: firebaseRecord.uid } })
        .catch(() => undefined);
      await this.firebase.auth
        .deleteUser(firebaseRecord.uid)
        .catch(() => undefined);
      throw error;
    }
  }

  private async completeRegistration(
    dto: RegisterDto,
    firebaseRecord: UserRecord,
  ) {
    const user = await this.createLocalUser(dto, firebaseRecord);
    const tokens = await this.firebase.signInWithPassword(
      dto.email,
      dto.password,
    );
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    // await this.sendEmail(
    //   dto.email,
    //   this.emailTemplates.renderWelcome({ firstName: dto.firstName }),
    // );

    return { user, ...toTokenPair(tokens) };
  }

  async login(dto: LoginDto) {
    const tokens = await this.firebase.signInWithPassword(
      dto.email,
      dto.password,
    );
    const user = await this.requireLocalUser(tokens.localId);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    return { user, ...toTokenPair(tokens) };
  }

  /** Firebase rejects a revoked refresh token itself, so no re-verify here. */
  async refreshToken(refreshToken: string) {
    const tokens = await this.firebase.refreshIdToken(refreshToken);
    const user = await this.requireLocalUser(tokens.localId);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    return toTokenPair(tokens);
  }

  async logout(user: UserModel): Promise<void> {
    await this.firebase.auth.revokeRefreshTokens(user.firebaseUid);
    await this.deleteRefreshToken(user.id);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.database.user.findUnique({
      where: { email },
      select: { firstName: true },
    });
    if (!user) {
      return;
    }

    const firebaseLink = await this.firebase.generatePasswordResetLink(email);
    if (!firebaseLink) {
      return;
    }

    // await this.sendEmail(
    //   email,
    //   this.emailTemplates.renderPasswordReset({
    //     firstName: user.firstName,
    //     resetLink: this.webappResetLink(firebaseLink),
    //   }),
    // );
  }

  async confirmForgotPassword(dto: ConfirmForgotPasswordDto): Promise<void> {
    await this.firebase.confirmPasswordReset(dto.oobCode, dto.newPassword);
  }

  async changePassword(user: UserModel, dto: ChangePasswordDto): Promise<void> {
    try {
      await this.firebase.signInWithPassword(user.email, dto.currentPassword);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new BadRequestException('Current password is incorrect');
      }
      throw error;
    }
    await this.firebase.auth.updateUser(user.firebaseUid, {
      password: dto.newPassword,
    });
    await this.firebase.auth.revokeRefreshTokens(user.firebaseUid);
    await this.deleteRefreshToken(user.id);
  }

  getCurrentUser(user: UserModel) {
    return this.database.user.findUniqueOrThrow({
      where: { id: user.id },
    });
  }

  // async bootstrapAdmin(firebaseUser: DecodedIdToken, dto: BootstrapAdminDto) {
  //   const adminCount = await this.database.adminProfile.count();
  //   if (adminCount > 0) {
  //     throw new ForbiddenException(
  //       'An admin already exists; use POST /admins instead',
  //     );
  //   }
  //   if (!firebaseUser.email) {
  //     throw new UnauthorizedException('Firebase token has no email');
  //   }

  //   return this.createAdmin(
  //     {
  //       firebaseUid: firebaseUser.uid,
  //       email: firebaseUser.email,
  //       isVerified: firebaseUser.email_verified ?? false,
  //     },
  //     dto,
  //     [],
  //   );
  // }

  // async promoteAdmin(dto: PromoteAdminDto) {
  //   const firebaseRecord = await this.firebase.getUserByEmail(dto.email);
  //   if (!firebaseRecord) {
  //     throw new NotFoundException('No Firebase account with that email');
  //   }

  //   return this.createAdmin(
  //     {
  //       firebaseUid: firebaseRecord.uid,
  //       email: dto.email,
  //       isVerified: firebaseRecord.emailVerified,
  //     },
  //     dto,
  //     dto.permissions ?? [],
  //   );
  // }

  private async createFirebaseUser(dto: RegisterDto): Promise<UserRecord> {
    try {
      return await this.firebase.auth.createUser({
        email: dto.email,
        password: dto.password,
        displayName: `${dto.firstName} ${dto.lastName}`.trim(),
      });
    } catch (error) {
      throw mapFirebaseCreateUserError(error);
    }
  }

  private async createLocalUser(dto: RegisterDto, firebaseRecord: UserRecord) {
    try {
      return await this.database.user.create({
        data: {
          firebaseUid: firebaseRecord.uid,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phoneNumber: dto.phoneNumber,
          role: dto.role,
          isVerified: firebaseRecord.emailVerified,
          farmer: dto.role === Role.FARMER ? { create: {} } : undefined,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Account already registered');
      }
      throw error;
    }
  }

  /** The local user for a Firebase account that just proved its credentials. */
  private async requireLocalUser(firebaseUid: string) {
    const user = await this.database.user.findUnique({
      where: { firebaseUid },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }

  /** One row per user: each login or refresh overwrites the last token. */
  private async saveRefreshToken(userId: string, token: string): Promise<void> {
    await this.database.refreshToken.upsert({
      where: { userId },
      create: { userId, token },
      update: { token },
    });
  }

  /** Once Firebase revokes the user's tokens, the stored one is dead too. */
  private async deleteRefreshToken(userId: string): Promise<void> {
    await this.database.refreshToken.deleteMany({ where: { userId } });
  }

  // /** Points Firebase's hosted reset action at the webapp's own screen. */
  // private webappResetLink(firebaseLink: string): string {
  //   const oobCode = new URL(firebaseLink).searchParams.get('oobCode');
  //   if (!oobCode) {
  //     throw new Error('Firebase password reset link carries no oobCode');
  //   }
  //   const [origin] = webappOrigins(
  //     this.config.get<string>('FRONTEND_WEBAPP_URL'),
  //   );
  //   const link = new URL('/reset-password', origin);
  //   link.searchParams.set('oobCode', oobCode);
  //   return link.toString();
  // }

  // private async sendEmail(to: string, email: RenderedEmail): Promise<void> {
  //   try {
  //     await this.notifications.send({
  //       type: NotificationType.EMAIL,
  //       to,
  //       subject: email.subject,
  //       message: email.text,
  //       html: email.html,
  //     });
  //   } catch (error) {
  //     this.logger.warn(`Failed to send "${email.subject}" to ${to}`, error);
  //   }
  // }
}

function toTokenPair(tokens: FirebaseAuthTokens) {
  return {
    accessToken: tokens.idToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  };
}

function mapFirebaseCreateUserError(error: unknown): Error {
  switch (firebaseErrorCode(error)) {
    case 'auth/email-already-exists':
      return new ConflictException('Account already registered');
    case 'auth/invalid-email':
      return new BadRequestException('Invalid email address');
    case 'auth/weak-password':
      return new BadRequestException('Password is too weak');
    default:
      return error instanceof Error ? error : new Error(String(error));
  }
}
