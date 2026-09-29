import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserRecord } from 'firebase-admin/auth';
import {
  RegisterDto,
  LoginDto,
  ChangePasswordDto,
  ConfirmForgotPasswordDto,
  GoogleLoginDto,
  GoogleRegisterDto,
  CreateLocalUserDto,
  FirebaseAuthTokensDto,
} from './dto';
import { firebaseErrorCode } from './firebase/firebase.errors';
import { FirebaseService } from './firebase/firebase.service';
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
      await this.database.user
        .deleteMany({ where: { firebaseUid: firebaseRecord.uid } })
        .catch(() => undefined);
      await this.deleteFirebaseUser(firebaseRecord.uid);
      throw error;
    }
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

  async googleLogin(dto: GoogleLoginDto) {
    const google = await this.firebase.signInWithGoogle(dto.idToken);
    const user = await this.database.user.findUnique({
      where: { firebaseUid: google.localId },
    });
    if (!user) {
      // Not a 401: the webapp reads a 401 as an expired session. A Firebase
      // account this call just created is dropped so it doesn't linger.
      if (google.isNewUser) {
        await this.deleteFirebaseUser(google.localId);
      }
      throw new NotFoundException('Account not registered');
    }
    await this.saveRefreshToken(user.id, google.refreshToken);
    return { user, ...toTokenPair(google) };
  }

  async googleRegister(dto: GoogleRegisterDto) {
    const google = await this.firebase.signInWithGoogle(dto.idToken);
    try {
      const user = await this.createLocalUser({
        firebaseUid: google.localId,
        email: google.email,
        firstName: google.firstName,
        lastName: google.lastName,
        phoneNumber: dto.phoneNumber,
        role: dto.role,
        isVerified: google.emailVerified,
        refreshToken: google.refreshToken,
      });
      return { user, ...toTokenPair(google) };
    } catch (error) {
      if (google.isNewUser) {
        await this.deleteFirebaseUser(google.localId);
      }
      throw error;
    }
  }

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

  private async completeRegistration(
    dto: RegisterDto,
    firebaseRecord: UserRecord,
  ) {
    const user = await this.createLocalUser({
      firebaseUid: firebaseRecord.uid,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phoneNumber: dto.phoneNumber,
      role: dto.role,
      isVerified: firebaseRecord.emailVerified,
    });
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

  private async createLocalUser({
    refreshToken,
    ...input
  }: CreateLocalUserDto) {
    try {
      return await this.database.user.create({
        data: {
          ...input,
          farmer: input.role === Role.FARMER ? { create: {} } : undefined,
          // Every agent owns exactly one cluster, so it is born with them.
          agent:
            input.role === Role.EXTENSION_AGENT
              ? { create: { cluster: { create: {} } } }
              : undefined,
          refreshToken: refreshToken
            ? { create: { token: refreshToken } }
            : undefined,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Account already registered');
      }
      throw error;
    }
  }

  private async deleteFirebaseUser(firebaseUid: string): Promise<void> {
    await this.firebase.auth.deleteUser(firebaseUid).catch((error) => {
      this.logger.warn(`Failed to delete Firebase user ${firebaseUid}`, error);
    });
  }

  private async requireLocalUser(firebaseUid: string) {
    const user = await this.database.user.findUnique({
      where: { firebaseUid },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }

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
}

function toTokenPair(tokens: FirebaseAuthTokensDto) {
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
