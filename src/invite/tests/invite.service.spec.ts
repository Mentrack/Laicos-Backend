import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invite, Prisma, Role, User } from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { INVITE_TTL_DAYS, InviteService } from '../invite.service';
import { InviteStatus } from '../dto';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const WEEK = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
const inviter = { id: 'user-1', role: Role.ADMIN } as User;
const email = 'new@laicos.test';

function invite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: 'invite-1',
    email,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(NOW.getTime() + WEEK),
    role: Role.ADMIN,
    invitedById: inviter.id,
    acceptedAt: null,
    userId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('InviteService', () => {
  const database = {
    user: { findUnique: jest.fn() },
    invite: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const mail = { send: jest.fn() };
  const config = {
    getOrThrow: jest.fn().mockReturnValue('https://app.laicos.ng'),
  };
  const service = new InviteService(
    database as unknown as PrismaService,
    {} as AuthService,
    mail as unknown as MailService,
    config as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    config.getOrThrow.mockReturnValue('https://app.laicos.ng');
    database.user.findUnique.mockResolvedValue(null);
    database.invite.create.mockResolvedValue(invite());
    mail.send.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('invite', () => {
    it('creates a pending invite and emails the link', async () => {
      const result = await service.invite(inviter, email, Role.ADMIN);

      expect(database.invite.create).toHaveBeenCalledWith({
        data: {
          email,
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
          role: Role.ADMIN,
          invitedById: inviter.id,
          expiresAt: new Date(NOW.getTime() + WEEK),
        },
      });
      const [to, rendered] = mail.send.mock.calls[0] as [
        string,
        { html: string },
      ];
      expect(to).toBe(email);
      expect(rendered.html).toContain(
        'https://app.laicos.ng/admin-invite?token=',
      );
      expect(rendered.html).not.toContain('Temporary password');
      expect(result).toEqual({
        id: 'invite-1',
        email,
        expiresAt: new Date(NOW.getTime() + WEEK),
        acceptedAt: null,
        createdAt: NOW,
      });
    });

    it('rejects an email that already has an account', async () => {
      database.user.findUnique.mockResolvedValue({ id: 'user-9' });

      await expect(service.invite(inviter, email, Role.ADMIN)).rejects.toThrow(
        new ConflictException('Account already registered'),
      );
      expect(database.invite.create).not.toHaveBeenCalled();
    });

    it('409s on a pending invite with the role-neutral message', async () => {
      database.invite.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.invite(inviter, email, Role.EXTENSION_AGENT),
      ).rejects.toThrow(
        new ConflictException('This email already has a pending invite'),
      );
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('stores the given role', async () => {
      await service.invite(inviter, email, Role.EXTENSION_AGENT);

      expect(database.invite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: Role.EXTENSION_AGENT,
        }) as object,
      });
    });

    it('emails an agent link for EXTENSION_AGENT', async () => {
      await service.invite(inviter, email, Role.EXTENSION_AGENT);

      const [, rendered] = mail.send.mock.calls[0] as [
        string,
        { html: string },
      ];
      expect(rendered.html).toContain(
        'https://app.laicos.ng/agent-invite?token=',
      );
    });

    it('keeps the invite when the email fails', async () => {
      mail.send.mockRejectedValue(new Error('smtp down'));
      const logged = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.invite(inviter, email, Role.ADMIN),
      ).resolves.toMatchObject({
        id: 'invite-1',
      });
      expect(logged).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it.each([
      [InviteStatus.PENDING, { role: Role.ADMIN, acceptedAt: null }],
      [InviteStatus.ACCEPTED, { role: Role.ADMIN, acceptedAt: { not: null } }],
      [undefined, { role: Role.ADMIN }],
    ])('filters %s by role', async (status, where) => {
      database.invite.findMany.mockResolvedValue([invite()]);
      database.invite.count.mockResolvedValue(21);

      const result = await service.findAll(
        { page: 2, perPage: 10, status },
        Role.ADMIN,
      );

      expect(database.invite.findMany).toHaveBeenCalledWith({
        where,
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(database.invite.count).toHaveBeenCalledWith({ where });
      expect(result.metaData).toEqual({
        page: 2,
        perPage: 10,
        total: 21,
        totalPages: 3,
      });
      expect(result.data).toHaveLength(1);
    });
  });

  describe('resend', () => {
    const GRACE = 10 * 60 * 1000;
    const cutoff = new Date(NOW.getTime() - GRACE);

    beforeEach(() => {
      database.invite.updateMany.mockResolvedValue({ count: 1 });
      database.invite.findUniqueOrThrow.mockResolvedValue(invite());
    });

    it('replaces the token hash and emails the new link', async () => {
      const stored = invite();
      database.invite.findFirst.mockResolvedValue(stored);

      await service.resend(stored.id, Role.ADMIN);

      const [args] = database.invite.updateMany.mock.calls[0] as [
        {
          where: unknown;
          data: { tokenHash: string; expiresAt: Date; acceptedAt: null };
        },
      ];
      expect(args.where).toEqual({
        id: stored.id,
        userId: null,
        OR: [{ acceptedAt: null }, { acceptedAt: { lt: cutoff } }],
      });
      expect(args.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(args.data.tokenHash).not.toBe(stored.tokenHash);
      expect(args.data.expiresAt).toEqual(new Date(NOW.getTime() + WEEK));
      expect(mail.send).toHaveBeenCalledWith(email, expect.anything());
    });

    it('recovers a stuck claim older than the grace period', async () => {
      const stored = invite({ acceptedAt: new Date(cutoff.getTime() - 1) });
      database.invite.findFirst.mockResolvedValue(stored);

      await service.resend(stored.id, Role.ADMIN);

      const [args] = database.invite.updateMany.mock.calls[0] as [
        { data: { tokenHash: string; expiresAt: Date; acceptedAt: null } },
      ];
      expect(args.data.acceptedAt).toBeNull();
      expect(args.data.tokenHash).not.toBe(stored.tokenHash);
      expect(args.data.expiresAt).toEqual(new Date(NOW.getTime() + WEEK));
      expect(mail.send).toHaveBeenCalledWith(email, expect.anything());
    });

    it('404s an unknown invite', async () => {
      database.invite.findFirst.mockResolvedValue(null);

      await expect(service.resend('nope', Role.ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s for an invite of the other role', async () => {
      database.invite.findFirst.mockResolvedValue(null);

      await expect(
        service.resend('invite-1', Role.EXTENSION_AGENT),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(database.invite.findFirst).toHaveBeenCalledWith({
        where: { id: 'invite-1', role: Role.EXTENSION_AGENT },
      });
    });

    it('409s an accepted invite', async () => {
      database.invite.findFirst.mockResolvedValue(
        invite({ acceptedAt: NOW, userId: 'user-2' }),
      );

      await expect(
        service.resend('invite-1', Role.ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.invite.updateMany).not.toHaveBeenCalled();
    });

    it('409s a claim inside the grace period', async () => {
      database.invite.findFirst.mockResolvedValue(
        invite({ acceptedAt: new Date(NOW.getTime() - 60_000) }),
      );

      await expect(
        service.resend('invite-1', Role.ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.invite.updateMany).not.toHaveBeenCalled();
    });

    it('409s when an accept wins the race', async () => {
      database.invite.findFirst.mockResolvedValue(invite());
      database.invite.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resend('invite-1', Role.ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('409s when the email now has an account', async () => {
      database.invite.findFirst.mockResolvedValue(invite());
      database.user.findUnique.mockResolvedValue({ id: 'user-9' });

      await expect(
        service.resend('invite-1', Role.ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.invite.updateMany).not.toHaveBeenCalled();
    });
  });
});
