import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Role,
  type AdminInvite,
  type Prisma,
  type User,
} from '../../generated/client';
import { AuthService } from '../auth/auth.service';
import type { TokenPairDto } from '../auth/dto';
import { webappUrl } from '../common/config';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { isUniqueViolation } from '../common/prisma-errors';
import { MailService } from '../mail/mail.service';
import { adminInviteEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminInviteStatus,
  type AcceptAdminInviteDto,
  type AdminInviteDto,
  type AdminInviteQueryDto,
  type InviteAdminDto,
} from './dto';
import { toAdminInviteDto } from './formatters/admin-invite.formatter';
import { inviteExpiredError, inviteInvalidError } from './utils/invite-errors';
import { hashInviteToken, newInviteToken } from './utils/invite-token';

export const ADMIN_INVITE_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// Longer than any in-flight accept, so an older claim without a user is stuck.
const STUCK_CLAIM_GRACE_MS = 10 * 60 * 1000;

/**
 * Invites an admin by email. The account is created later, when they follow
 * the link and choose a name and password.
 */
@Injectable()
export class AdminInviteService {
  private readonly logger = new Logger(AdminInviteService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async invite(inviter: User, dto: InviteAdminDto): Promise<AdminInviteDto> {
    await this.assertNoAccount(dto.email);
    const { token, tokenHash } = newInviteToken();
    const expiresAt = this.expiry();
    let row: AdminInvite;
    try {
      row = await this.database.adminInvite.create({
        data: {
          email: dto.email,
          tokenHash,
          invitedById: inviter.id,
          expiresAt,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'This email already has a pending invite. Resend it instead.',
        );
      }
      throw error;
    }
    await this.sendEmail(row, token);
    return toAdminInviteDto(row);
  }

  async findAll(query: AdminInviteQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.AdminInviteWhereInput =
      query.status === AdminInviteStatus.PENDING
        ? { acceptedAt: null }
        : query.status === AdminInviteStatus.ACCEPTED
          ? { acceptedAt: { not: null } }
          : {};
    const [rows, total] = await Promise.all([
      this.database.adminInvite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.adminInvite.count({ where }),
    ]);
    return {
      data: rows.map(toAdminInviteDto),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async resend(id: string): Promise<AdminInviteDto> {
    const invite = await this.database.adminInvite.findUnique({
      where: { id },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    const graceCutoff = new Date(Date.now() - STUCK_CLAIM_GRACE_MS);
    if (
      invite.userId ||
      (invite.acceptedAt && invite.acceptedAt >= graceCutoff)
    ) {
      throw new ConflictException('Invite already accepted');
    }
    await this.assertNoAccount(invite.email);
    const { token, tokenHash } = newInviteToken();
    // Repeats the state checked above so a concurrent accept can't be
    // overwritten; clearing acceptedAt recovers a stuck claim.
    const { count } = await this.database.adminInvite.updateMany({
      where: {
        id,
        userId: null,
        OR: [{ acceptedAt: null }, { acceptedAt: { lt: graceCutoff } }],
      },
      data: { tokenHash, expiresAt: this.expiry(), acceptedAt: null },
    });
    if (count === 0) {
      throw new ConflictException('Invite already accepted');
    }
    const row = await this.database.adminInvite.findUniqueOrThrow({
      where: { id },
    });
    await this.sendEmail(row, token);
    return toAdminInviteDto(row);
  }

  async accept(
    dto: AcceptAdminInviteDto,
  ): Promise<{ user: User } & TokenPairDto> {
    const invite = await this.database.adminInvite.findUnique({
      where: { tokenHash: hashInviteToken(dto.token) },
    });
    if (!invite || invite.acceptedAt) {
      throw inviteInvalidError();
    }
    const now = new Date();
    if (invite.expiresAt <= now) {
      throw inviteExpiredError();
    }
    await this.assertNoAccount(invite.email);

    // The conditional claim is what serialises concurrent accepts: only one
    // request sees count 1. The tokenHash match makes a resend that rotated
    // the hash after the read above kill this link. Expiry is re-checked here so the invite can't
    // lapse between the read above and the claim.
    const { count } = await this.database.adminInvite.updateMany({
      where: {
        id: invite.id,
        tokenHash: invite.tokenHash,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now },
    });
    if (count === 0) {
      throw inviteInvalidError();
    }

    let firebaseUid: string;
    try {
      ({ uid: firebaseUid } = await this.auth.createFirebaseUser({
        email: invite.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        password: dto.password,
        emailVerified: true,
      }));
    } catch (error) {
      await this.releaseClaim(invite.id);
      throw error;
    }

    let user: User;
    try {
      user = await this.database.$transaction(async (tx) => {
        const created = await this.auth.createLocalUser(
          {
            firebaseUid,
            email: invite.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phoneNumber: dto.phoneNumber,
            role: Role.ADMIN,
            isVerified: true,
            agreedToTerms: true,
          },
          tx,
        );
        await tx.adminInvite.update({
          where: { id: invite.id },
          data: { userId: created.id },
        });
        return created;
      });
    } catch (error) {
      await this.auth.deleteFirebaseUser(firebaseUid);
      await this.releaseClaim(invite.id);
      throw error;
    }

    return this.auth.startSession(user);
  }

  // Lets the invitee retry. A failed release is logged, not thrown, so the
  // caller still sees the error that caused it.
  private async releaseClaim(id: string) {
    await this.database.adminInvite
      .updateMany({
        where: { id, userId: null },
        data: { acceptedAt: null },
      })
      .catch((error: unknown) => {
        this.logger.error(`Admin invite ${id} claim not released`, error);
      });
  }

  private expiry(): Date {
    return new Date(Date.now() + ADMIN_INVITE_TTL_DAYS * DAY_MS);
  }

  private async assertNoAccount(email: string) {
    const existing = await this.database.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Account already registered');
    }
  }

  // The invite stands without the email; an admin can resend it.
  private async sendEmail(invite: AdminInvite, token: string) {
    await this.mail
      .send(
        invite.email,
        adminInviteEmail({
          acceptUrl: webappUrl(
            this.config,
            `/admin-invite?token=${encodeURIComponent(token)}`,
          ),
          expiresAt: invite.expiresAt,
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Admin invite email not sent for ${invite.id}`,
          error,
        );
      });
  }
}
