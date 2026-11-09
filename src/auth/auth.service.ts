import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
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
  TokenPairDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto';
import { EmailOtpService } from './email-otp.service';
import { firebaseErrorCode } from './firebase/firebase.errors';
import { FirebaseService } from './firebase/firebase.service';
import {
  isPendingActivation,
  isSelfSignupRole,
  verificationPendingError,
} from './utils/pending-access';
import {
  emailNotVerifiedError,
  invalidVerificationCodeError,
  needsEmailVerification,
} from './utils/email-verification';
import { passwordResetUrl } from './utils/password-reset-url';
import {
  IMAGE_SIGNATURES,
  matchSignature,
  type StorageUploadFile,
} from '../common/upload-pipes';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail } from '../mail/templates';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  Role,
  type Prisma,
  type User as UserModel,
} from '../../generated/client';
import { isUniqueViolation } from '../common/prisma-errors';
import { assertBuyerKind, buyerCreateData } from '../buyer/utils/buyer-kind';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly otp: EmailOtpService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
    assertBuyerKind(dto.role, dto);
    const firebaseRecord = await this.createFirebaseUser(dto);
    let user: UserModel;
    try {
      user = await this.database.$transaction(async (tx) => {
        const created = await this.createLocalUser(
          {
            firebaseUid: firebaseRecord.uid,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phoneNumber: dto.phoneNumber,
            role: dto.role,
            isVerified: false,
            buyer: dto.role === Role.BUYER ? buyerCreateData(dto) : undefined,
          },
          tx,
        );
        await this.createDraftApplication(tx, created);
        return created;
      });
    } catch (error) {
      await this.deleteFirebaseUser(firebaseRecord.uid);
      throw error;
    }
    // The account stands without the email: rolling back would turn the
    // user's retry into a 409. "Resend code" recovers.
    await this.otp.issue(user).catch((error) => {
      this.logger.error(`Verification code not sent to user ${user.id}`, error);
    });
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.database.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw invalidVerificationCodeError();
    }
    // Only buyers and riders are ever issued a code, and only until verified.
    await this.otp.verify(user.id, dto.code);
    // Every step is idempotent and the code is discarded last, so a failure
    // anywhere lets the user retry with the same code.
    await this.firebase.auth.updateUser(user.firebaseUid, {
      emailVerified: true,
    });
    const verified = await this.database.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });
    const session = await this.startSession(verified);
    await this.otp.discard(user.id);
    return session;
  }

  async startSession(
    user: UserModel,
  ): Promise<{ user: UserModel } & TokenPairDto> {
    const tokens = await this.firebase.signInWithCustomToken(user.firebaseUid);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    return { user, ...toTokenPair(tokens) };
  }

  resendVerification(email: string): Promise<void> {
    return this.otp.resend(email);
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
    const verified = await this.trustGoogleVerification(user, google);
    await this.assertCanSignIn(verified);
    await this.saveRefreshToken(verified.id, google.refreshToken);
    return { user: verified, ...toTokenPair(google) };
  }

  async googleRegister(dto: GoogleRegisterDto) {
    assertBuyerKind(dto.role, dto);
    const google = await this.firebase.signInWithGoogle(dto.idToken);
    try {
      const user = await this.database.$transaction(async (tx) => {
        const created = await this.createLocalUser(
          {
            firebaseUid: google.localId,
            email: google.email,
            firstName: google.firstName,
            lastName: google.lastName,
            phoneNumber: dto.phoneNumber,
            role: dto.role,
            isVerified: google.emailVerified,
            refreshToken: google.refreshToken,
            buyer: dto.role === Role.BUYER ? buyerCreateData(dto) : undefined,
          },
          tx,
        );
        await this.createDraftApplication(tx, created);
        return created;
      });
      // A farmer or agent whose Google address is not verified gets the same
      // code as email signup, and no session until they enter it.
      if (isSelfSignupRole(user.role) && !user.isVerified) {
        await this.otp.issue(user).catch((error) => {
          this.logger.error(
            `Verification code not sent to user ${user.id}`,
            error,
          );
        });
        return { user };
      }
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
    await this.database.pushDevice.deleteMany({ where: { userId: user.id } });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.database.user.findUnique({
      where: { email },
      select: { id: true, firstName: true, role: true, activatedAt: true },
    });
    // An onboarded farmer has no password until their invite. An applicant
    // chose theirs, so they can reset it before anyone approves them.
    if (!user || (await this.blocksPasswordReset(user))) {
      return;
    }

    const firebaseLink = await this.firebase.generatePasswordResetLink(email);
    if (!firebaseLink) {
      return;
    }
    await this.mail.send(
      email,
      passwordResetEmail({
        firstName: user.firstName,
        resetUrl: passwordResetUrl(this.config, firebaseLink),
      }),
    );
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

  async getCurrentUser(user: UserModel) {
    const row = await this.database.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { application: { select: { status: true } } },
    });
    const { application, ...rest } = row;
    return { ...rest, applicationStatus: application?.status ?? null };
  }

  updateProfile(user: UserModel, dto: UpdateProfileDto) {
    const summary = profileFieldSummary(dto);
    if (user.role !== Role.FARMER && user.role !== Role.EXTENSION_AGENT) {
      return this.database.user.update({
        where: { id: user.id },
        data: dto,
      });
    }
    return this.database.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: dto,
      });
      if (summary) {
        if (user.role === Role.FARMER) {
          const farmer = await tx.farmer.findUniqueOrThrow({
            where: { userId: user.id },
            select: { id: true },
          });
          await this.audit.record(tx, {
            actorType: AuditActorType.FARMER,
            farmerId: farmer.id,
            agentId: null,
            farmId: null,
            category: AuditCategory.PROFILE,
            title: 'Profile updated',
            summary,
            actionLabel: 'View profile',
            resource: AuditResource.FARMER,
            resourceId: farmer.id,
          });
        } else {
          const agent = await tx.agent.findUniqueOrThrow({
            where: { userId: user.id },
            select: { id: true },
          });
          await this.audit.record(tx, {
            actorType: AuditActorType.EXTENSION_AGENT,
            farmerId: null,
            agentId: agent.id,
            farmId: null,
            category: AuditCategory.PROFILE,
            title: 'Profile updated',
            summary,
            actionLabel: 'View profile',
            resource: AuditResource.AGENT,
            resourceId: agent.id,
          });
        }
      }
      return updated;
    });
  }

  async uploadAvatar(user: UserModel, file: StorageUploadFile) {
    const { contentType, extension } = matchSignature(IMAGE_SIGNATURES, file);
    const avatarUrl = await this.storage.uploadPublic(
      `users/${user.id}/${randomUUID()}.${extension}`,
      file.buffer,
      contentType,
    );
    return this.database.user.update({
      where: { id: user.id },
      data: { avatarUrl },
    });
  }

  /** No `password` leaves an account nobody can sign in to: a new farmer. */
  async createFirebaseUser(
    dto: Pick<RegisterDto, 'email' | 'firstName' | 'lastName'> & {
      password?: string;
      emailVerified?: boolean;
    },
  ): Promise<UserRecord> {
    try {
      return await this.firebase.auth.createUser({
        email: dto.email,
        password: dto.password,
        displayName: `${dto.firstName} ${dto.lastName}`.trim(),
        ...(dto.emailVerified === undefined
          ? {}
          : { emailVerified: dto.emailVerified }),
      });
    } catch (error) {
      throw mapFirebaseCreateUserError(error);
    }
  }

  /** Takes `client` so a caller can create the user inside its transaction. */
  async createLocalUser(
    { refreshToken, farmer, agent, buyer, admin, ...input }: CreateLocalUserDto,
    client: Prisma.TransactionClient = this.database,
  ) {
    try {
      return await client.user.create({
        data: {
          ...input,
          // Signup omits these. Agent onboarding passes `farmer`; an agent
          // row is only written when the caller passes one.
          farmer:
            input.role === Role.FARMER && farmer
              ? { create: farmer }
              : undefined,
          agent:
            input.role === Role.EXTENSION_AGENT && agent
              ? { create: { cluster: { create: {} }, ...agent } }
              : undefined,
          buyer:
            input.role === Role.BUYER ? { create: buyer ?? {} } : undefined,
          admin:
            input.role === Role.ADMIN ? { create: admin ?? {} } : undefined,
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

  async deleteFirebaseUser(firebaseUid: string): Promise<void> {
    await this.firebase.auth.deleteUser(firebaseUid).catch((error) => {
      this.logger.warn(`Failed to delete Firebase user ${firebaseUid}`, error);
    });
  }

  // Google proving the address counts as our code: a password buyer who never
  // entered theirs is verified by signing in with Google.
  private async trustGoogleVerification(
    user: UserModel,
    google: { emailVerified: boolean },
  ): Promise<UserModel> {
    if (user.isVerified || !google.emailVerified) {
      return user;
    }
    return this.database.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });
  }

  /** The local user for a sign-in, refusing anyone awaiting verification or an email check. */
  private async requireLocalUser(firebaseUid: string) {
    const user = await this.database.user.findUnique({
      where: { firebaseUid },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    await this.assertCanSignIn(user);
    return user;
  }

  /**
   * Buyers and riders must verify their email. A self-signup farmer or agent
   * must too, and can then sign in before approval. An onboarded farmer has
   * no application and stays on VERIFICATION_PENDING until the invite.
   */
  private async assertCanSignIn(user: UserModel): Promise<void> {
    if (isPendingActivation(user)) {
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
    }
    if (needsEmailVerification(user)) {
      throw emailNotVerifiedError();
    }
  }

  /** Onboarded farmers stay silent. Applicants, buyers and riders get a link. */
  private async blocksPasswordReset(
    user: Pick<UserModel, 'id' | 'role' | 'activatedAt'>,
  ): Promise<boolean> {
    if (!isPendingActivation(user)) {
      return false;
    }
    const application = await this.database.application.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    return !application;
  }

  /** Farmers and agents file this after signup. Other roles have none. */
  private async createDraftApplication(
    tx: Prisma.TransactionClient,
    user: UserModel,
  ): Promise<void> {
    if (!isSelfSignupRole(user.role)) {
      return;
    }
    await tx.application.create({ data: { userId: user.id } });
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

function profileFieldSummary(dto: UpdateProfileDto): string | null {
  const parts: string[] = [];
  if (dto.firstName !== undefined) {
    parts.push('first name');
  }
  if (dto.lastName !== undefined) {
    parts.push('last name');
  }
  if (dto.phoneNumber !== undefined) {
    parts.push('phone');
  }
  return joinAuditSummaryParts(parts);
}

function joinAuditSummaryParts(parts: string[]): string | null {
  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
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
