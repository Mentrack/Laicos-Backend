import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminInvite, Prisma, Role, User } from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ADMIN_INVITE_TTL_DAYS,
  AdminInviteService,
} from '../admin-invite.service';
import { AdminInviteStatus } from '../dto';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const WEEK = ADMIN_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
const inviter = { id: 'user-1', role: Role.ADMIN } as User;
const email = 'new@laicos.test';

function invite(overrides: Partial<AdminInvite> = {}): AdminInvite {
  return {
    id: 'invite-1',
    email,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(NOW.getTime() + WEEK),
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

describe('AdminInviteService', () => {
  const database = {
    user: { findUnique: jest.fn() },
    adminInvite: {
      create: jest.fn(),
      findUnique: jest.fn(),
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
  const service = new AdminInviteService(
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
    database.adminInvite.create.mockResolvedValue(invite());
    mail.send.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('invite', () => {
    it('creates a pending invite and emails the link', async () => {
      const result = await service.invite(inviter, { email });

      expect(database.adminInvite.create).toHaveBeenCalledWith({
        data: {
          email,
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
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

      await expect(service.invite(inviter, { email })).rejects.toThrow(
        new ConflictException('Account already registered'),
      );
      expect(database.adminInvite.create).not.toHaveBeenCalled();
    });

    it('rejects an email with a pending invite', async () => {
      database.adminInvite.create.mockRejectedValue(uniqueViolation());

      const error = await service
        .invite(inviter, { email })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain('Resend');
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('keeps the invite when the email fails', async () => {
      mail.send.mockRejectedValue(new Error('smtp down'));
      const logged = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);

      await expect(service.invite(inviter, { email })).resolves.toMatchObject({
        id: 'invite-1',
      });
      expect(logged).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it.each([
      [AdminInviteStatus.PENDING, { acceptedAt: null }],
      [AdminInviteStatus.ACCEPTED, { acceptedAt: { not: null } }],
      [undefined, {}],
    ])('filters %s', async (status, where) => {
      database.adminInvite.findMany.mockResolvedValue([invite()]);
      database.adminInvite.count.mockResolvedValue(21);

      const result = await service.findAll({ page: 2, perPage: 10, status });

      expect(database.adminInvite.findMany).toHaveBeenCalledWith({
        where,
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(database.adminInvite.count).toHaveBeenCalledWith({ where });
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
      database.adminInvite.updateMany.mockResolvedValue({ count: 1 });
      database.adminInvite.findUniqueOrThrow.mockResolvedValue(invite());
    });

    it('replaces the token hash and emails the new link', async () => {
      const stored = invite();
      database.adminInvite.findUnique.mockResolvedValue(stored);

      await service.resend(stored.id);

      const [args] = database.adminInvite.updateMany.mock.calls[0] as [
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
      database.adminInvite.findUnique.mockResolvedValue(stored);

      await service.resend(stored.id);

      const [args] = database.adminInvite.updateMany.mock.calls[0] as [
        { data: { tokenHash: string; expiresAt: Date; acceptedAt: null } },
      ];
      expect(args.data.acceptedAt).toBeNull();
      expect(args.data.tokenHash).not.toBe(stored.tokenHash);
      expect(args.data.expiresAt).toEqual(new Date(NOW.getTime() + WEEK));
      expect(mail.send).toHaveBeenCalledWith(email, expect.anything());
    });

    it('404s an unknown invite', async () => {
      database.adminInvite.findUnique.mockResolvedValue(null);

      await expect(service.resend('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s an accepted invite', async () => {
      database.adminInvite.findUnique.mockResolvedValue(
        invite({ acceptedAt: NOW, userId: 'user-2' }),
      );

      await expect(service.resend('invite-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(database.adminInvite.updateMany).not.toHaveBeenCalled();
    });

    it('409s a claim inside the grace period', async () => {
      database.adminInvite.findUnique.mockResolvedValue(
        invite({ acceptedAt: new Date(NOW.getTime() - 60_000) }),
      );

      await expect(service.resend('invite-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(database.adminInvite.updateMany).not.toHaveBeenCalled();
    });

    it('409s when an accept wins the race', async () => {
      database.adminInvite.findUnique.mockResolvedValue(invite());
      database.adminInvite.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.resend('invite-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('409s when the email now has an account', async () => {
      database.adminInvite.findUnique.mockResolvedValue(invite());
      database.user.findUnique.mockResolvedValue({ id: 'user-9' });

      await expect(service.resend('invite-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(database.adminInvite.updateMany).not.toHaveBeenCalled();
    });
  });
});
