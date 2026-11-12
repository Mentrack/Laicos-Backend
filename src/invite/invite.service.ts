import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Role,
  type Invite,
  type Prisma,
  type User,
} from '../../generated/client';
import { AuthService } from '../auth/auth.service';
import type { TokenPairDto } from '../auth/dto';
import { webappUrl } from '../common/config';
import {
  paginationMeta,
  resolvePagination,
  type PaginationMetaDto,
} from '../common/pagination';
import { isUniqueViolation } from '../common/prisma-errors';
import { MailService } from '../mail/mail.service';
import { adminInviteEmail, agentInviteEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import {
  InviteStatus,
  type AcceptInviteDto,
  type InviteDto,
  type InviteQueryDto,
} from './dto';
import { toInviteDto } from './formatters/invite.formatter';
import { inviteExpiredError, inviteInvalidError } from './utils/invite-errors';
import { hashInviteToken, newInviteToken } from './utils/invite-token';

export type InviteRole = typeof Role.ADMIN | typeof Role.EXTENSION_AGENT;

export const INVITE_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// Longer than any in-flight accept, so an older claim without a user is stuck.
const STUCK_CLAIM_GRACE_MS = 10 * 60 * 1000;

const ROLES: Record<
  InviteRole,
  { path: string; email: typeof adminInviteEmail }
> = {
  [Role.ADMIN]: { path: '/admin-invite', email: adminInviteEmail },
  [Role.EXTENSION_AGENT]: { path: '/agent-invite', email: agentInviteEmail },
};

/**
 * Invites an admin or extension agent by email. The account is created later,
 * when they follow the link and choose a name and password.
 */
@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async invite(
    inviter: User,
    email: string,
    role: InviteRole,
  ): Promise<InviteDto> {
    await this.assertNoAccount(email);
    const { token, tokenHash } = newInviteToken();
    const expiresAt = this.expiry();
    let row: Invite;
    try {
      row = await this.database.invite.create({
        data: {
          email,
          tokenHash,
          role,
          invitedById: inviter.id,
          expiresAt,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This email already has a pending invite');
      }
      throw error;
    }
    await this.sendEmail(row, token, role);
    return toInviteDto(row);
  }

  async findAll(
    query: InviteQueryDto,
    role: InviteRole,
  ): Promise<{ data: InviteDto[]; metaData: PaginationMetaDto }> {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.InviteWhereInput =
      query.status === InviteStatus.PENDING
        ? { role, acceptedAt: null }
        : query.status === InviteStatus.ACCEPTED
          ? { role, acceptedAt: { not: null } }
          : { role };
    const [rows, total] = await Promise.all([
      this.database.invite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.invite.count({ where }),
    ]);
    return {
      data: rows.map(toInviteDto),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async resend(id: string, role: InviteRole): Promise<InviteDto> {
    const invite = await this.database.invite.findFirst({
      where: { id, role },
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
    const { count } = await this.database.invite.updateMany({
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
    const row = await this.database.invite.findUniqueOrThrow({
      where: { id },
    });
    await this.sendEmail(row, token, role);
    return toInviteDto(row);
  }

  async accept(
    dto: AcceptInviteDto,
    role: InviteRole,
  ): Promise<{ user: User } & TokenPairDto> {
    const invite = await this.database.invite.findUnique({
      where: { tokenHash: hashInviteToken(dto.token) },
    });
    // The other role's link is treated as unknown, so it reveals nothing.
    if (!invite || invite.role !== role || invite.acceptedAt) {
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
    const { count } = await this.database.invite.updateMany({
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
            role,
            isVerified: true,
            // An agent agrees to the terms in the application they file next.
            agreedToTerms: role === Role.ADMIN,
          },
          tx,
        );
        await this.auth.createDraftApplication(tx, created);
        await tx.invite.update({
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
    await this.database.invite
      .updateMany({
        where: { id, userId: null },
        data: { acceptedAt: null },
      })
      .catch((error: unknown) => {
        this.logger.error(`Invite ${id} claim not released`, error);
      });
  }

  private expiry(): Date {
    return new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS);
  }

  private async assertNoAccount(email: string) {
    const existing = await this.database.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Account already registered');
    }
  }

  // The invite stands without the email; an admin can resend it.
  private async sendEmail(invite: Invite, token: string, role: InviteRole) {
    const { path, email } = ROLES[role];
    await this.mail
      .send(
        invite.email,
        email({
          acceptUrl: webappUrl(
            this.config,
            `${path}?token=${encodeURIComponent(token)}`,
          ),
          expiresAt: invite.expiresAt,
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(`Invite email not sent for ${invite.id}`, error);
      });
  }
}
