import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '../../../generated/client';
import type { RenderedEmail } from '../../mail/templates';
import { MailService } from '../../mail/mail.service';
import { invalidVerificationCodeError } from '../utils/email-verification';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailOtpService } from '../email-otp.service';

const user = { id: 'user-1', email: 'ada@example.com', firstName: 'Ada' };

describe('EmailOtpService', () => {
  const emailVerificationCode = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  };
  const userDelegate = { findUnique: jest.fn() };
  const database = { emailVerificationCode, user: userDelegate };
  const mail = { send: jest.fn() };
  const service = new EmailOtpService(
    database as unknown as PrismaService,
    mail as unknown as MailService,
    new ConfigService({ OTP_SECRET: 'secret' }),
  );

  beforeEach(() => jest.clearAllMocks());

  /** Issues a code and returns what was stored and what was mailed. */
  async function issued() {
    await service.issue(user);
    const [{ create }] = emailVerificationCode.upsert.mock.calls[0] as [
      { create: { codeHash: string; expiresAt: Date; lastSentAt: Date } },
    ];
    const [, rendered] = mail.send.mock.calls[0] as [string, RenderedEmail];
    const code = /^(\d{4}) is your/.exec(rendered.subject)?.[1];
    if (!code) {
      throw new Error('No code in the subject');
    }
    return { row: { ...create, attempts: 0 }, code };
  }

  it('refuses to construct without OTP_SECRET', () => {
    expect(
      () =>
        new EmailOtpService(
          database as unknown as PrismaService,
          mail as unknown as MailService,
          new ConfigService({ OTP_SECRET: ' ' }),
        ),
    ).toThrow('OTP_SECRET must not be blank');
  });

  describe('issue', () => {
    it('stores a keyed hash, never the code', async () => {
      const { row, code } = await issued();
      expect(code).toMatch(/^\d{4}$/);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.codeHash).not.toContain(code);
    });

    it('expires the code after 10 minutes', async () => {
      const before = Date.now();
      const { row } = await issued();
      const lifetime = row.expiresAt.getTime() - before;
      expect(lifetime).toBeGreaterThanOrEqual(10 * 60_000);
      expect(lifetime).toBeLessThan(10 * 60_000 + 1_000);
    });

    it('resets attempts when it overwrites a code', async () => {
      await issued();
      expect(emailVerificationCode.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: expect.objectContaining({ attempts: 0 }) as unknown,
        }),
      );
    });
  });

  describe('issue counting', () => {
    it('starts a new day window for a first code', async () => {
      emailVerificationCode.findUnique.mockResolvedValue(null);
      await service.issue(user);
      const [args] = emailVerificationCode.upsert.mock.calls[0] as [
        { create: { sendCount: number } },
      ];
      expect(args.create.sendCount).toBe(1);
    });

    it('counts a code sent inside the window', async () => {
      emailVerificationCode.findUnique.mockResolvedValue({
        sendCount: 2,
        sendWindowStartedAt: new Date(Date.now() - 60_000),
      });
      await service.issue(user);
      const [args] = emailVerificationCode.upsert.mock.calls[0] as [
        { update: { sendCount: unknown; sendWindowStartedAt?: Date } },
      ];
      expect(args.update.sendCount).toEqual({ increment: 1 });
      expect(args.update.sendWindowStartedAt).toBeUndefined();
    });

    it('restarts the window after a day', async () => {
      emailVerificationCode.findUnique.mockResolvedValue({
        sendCount: 5,
        sendWindowStartedAt: new Date(Date.now() - 25 * 60 * 60_000),
      });
      await service.issue(user);
      const [args] = emailVerificationCode.upsert.mock.calls[0] as [
        { update: { sendCount: unknown; sendWindowStartedAt?: Date } },
      ];
      expect(args.update.sendCount).toBe(1);
      expect(args.update.sendWindowStartedAt).toBeInstanceOf(Date);
    });
  });

  describe('verify', () => {
    it('accepts the mailed code and leaves the row for the caller', async () => {
      const { row, code } = await issued();
      emailVerificationCode.findUnique.mockResolvedValue(row);
      await expect(service.verify('user-1', code)).resolves.toBeUndefined();
      expect(emailVerificationCode.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects when no code was issued', async () => {
      emailVerificationCode.findUnique.mockResolvedValue(null);
      await expect(service.verify('user-1', '1234')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an expired code even when it matches', async () => {
      const { row, code } = await issued();
      emailVerificationCode.findUnique.mockResolvedValue({
        ...row,
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(service.verify('user-1', code)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('counts a wrong guess atomically', async () => {
      const { row, code } = await issued();
      emailVerificationCode.findUnique.mockResolvedValue(row);
      emailVerificationCode.update.mockResolvedValue({ ...row, attempts: 1 });
      const wrong = code === '0000' ? '0001' : '0000';
      await expect(service.verify('user-1', wrong)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(emailVerificationCode.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { attempts: { increment: 1 } },
      });
      expect(emailVerificationCode.deleteMany).not.toHaveBeenCalled();
    });

    it('answers a code discarded mid-guess like a wrong code', async () => {
      const { row, code } = await issued();
      emailVerificationCode.findUnique.mockResolvedValue(row);
      emailVerificationCode.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('gone', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      const wrong = code === '0000' ? '0001' : '0000';
      await expect(service.verify('user-1', wrong)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('kills the code on the fifth wrong guess, answering like any wrong code', async () => {
      const { row, code } = await issued();
      emailVerificationCode.findUnique.mockResolvedValue({
        ...row,
        attempts: 4,
      });
      emailVerificationCode.update.mockResolvedValue({ ...row, attempts: 5 });
      const wrong = code === '0000' ? '0001' : '0000';
      await expect(service.verify('user-1', wrong)).rejects.toEqual(
        invalidVerificationCodeError(),
      );
      expect(emailVerificationCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('resend', () => {
    const unverified = {
      ...user,
      role: Role.BUYER,
      isVerified: false,
      emailVerificationCode: null,
    };

    it('does nothing for an unknown email', async () => {
      userDelegate.findUnique.mockResolvedValue(null);
      await service.resend('nobody@example.com');
      expect(emailVerificationCode.upsert).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('does nothing for a verified user', async () => {
      userDelegate.findUnique.mockResolvedValue({
        ...unverified,
        isVerified: true,
      });
      await service.resend(user.email);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('sends nothing inside the 60-second cooldown, answering as usual', async () => {
      userDelegate.findUnique.mockResolvedValue({
        ...unverified,
        emailVerificationCode: {
          lastSentAt: new Date(Date.now() - 30_000),
          sendCount: 1,
          sendWindowStartedAt: new Date(Date.now() - 30_000),
        },
      });
      await expect(service.resend(user.email)).resolves.toBeUndefined();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('sends a ninth and tenth code in a day', async () => {
      userDelegate.findUnique.mockResolvedValue({
        ...unverified,
        emailVerificationCode: {
          lastSentAt: new Date(Date.now() - 61_000),
          sendCount: 9,
          sendWindowStartedAt: new Date(Date.now() - 60 * 60_000),
        },
      });
      await service.resend(user.email);
      expect(mail.send).toHaveBeenCalled();
    });

    it('caps codes at ten a day, silently', async () => {
      userDelegate.findUnique.mockResolvedValue({
        ...unverified,
        emailVerificationCode: {
          lastSentAt: new Date(Date.now() - 61_000),
          sendCount: 10,
          sendWindowStartedAt: new Date(Date.now() - 60 * 60_000),
        },
      });
      await expect(service.resend(user.email)).resolves.toBeUndefined();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('lifts the cap once the day has passed', async () => {
      userDelegate.findUnique.mockResolvedValue({
        ...unverified,
        emailVerificationCode: {
          lastSentAt: new Date(Date.now() - 61_000),
          sendCount: 10,
          sendWindowStartedAt: new Date(Date.now() - 25 * 60 * 60_000),
        },
      });
      await service.resend(user.email);
      expect(mail.send).toHaveBeenCalled();
    });

    it('issues a fresh code after the cooldown', async () => {
      userDelegate.findUnique.mockResolvedValue({
        ...unverified,
        emailVerificationCode: {
          lastSentAt: new Date(Date.now() - 61_000),
          sendCount: 1,
          sendWindowStartedAt: new Date(Date.now() - 61_000),
        },
      });
      await service.resend(user.email);
      expect(mail.send).toHaveBeenCalledWith(user.email, expect.anything());
    });
  });
});
