import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { requireConfig } from '../common/config';
import { isRecordNotFound } from '../common/prisma-errors';
import { MailService } from '../mail/mail.service';
import { emailVerificationCodeEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, User } from '../../generated/client';
import {
  OTP_LENGTH,
  OTP_TTL_MINUTES,
  invalidVerificationCodeError,
  needsEmailVerification,
} from './utils/email-verification';

const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;
// With 5 guesses a code, this caps guesses at 50 a day: without it, resends
// make 4 digits brute-forceable within a day.
const MAX_CODES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60_000;

@Injectable()
export class EmailOtpService {
  private readonly secret: string;

  constructor(
    private readonly database: PrismaService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.secret = requireConfig(config, 'OTP_SECRET');
  }

  async issue(user: Pick<User, 'id' | 'email' | 'firstName'>): Promise<void> {
    const code = randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');
    const now = new Date();
    const fields = {
      codeHash: this.hash(user.id, code),
      expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
      attempts: 0,
      lastSentAt: now,
    };
    const existing = await this.database.emailVerificationCode.findUnique({
      where: { userId: user.id },
    });
    const sameDay = existing && !isNewDay(existing.sendWindowStartedAt);
    await this.database.emailVerificationCode.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...fields,
        sendCount: 1,
        sendWindowStartedAt: now,
      },
      update: sameDay
        ? { ...fields, sendCount: { increment: 1 } }
        : { ...fields, sendCount: 1, sendWindowStartedAt: now },
    });
    await this.mail.send(
      user.email,
      emailVerificationCodeEmail({
        firstName: user.firstName,
        code,
        expiresInMinutes: OTP_TTL_MINUTES,
      }),
    );
  }

  async verify(userId: string, code: string): Promise<void> {
    const row = await this.database.emailVerificationCode.findUnique({
      where: { userId },
    });
    if (!row || row.expiresAt <= new Date()) {
      throw invalidVerificationCodeError();
    }
    if (this.matches(row.codeHash, userId, code)) {
      return;
    }
    // Increment in the database and read the result back, so parallel
    // guesses can't each see attempts below the limit.
    const attempts = await this.recordWrongGuess(userId);
    if (attempts >= MAX_ATTEMPTS) {
      await this.discard(userId);
    }
    // The same answer at the limit: a distinct one would confirm the account.
    throw invalidVerificationCodeError();
  }

  /** The new attempt count; a code discarded meanwhile reads as wrong. */
  private async recordWrongGuess(userId: string): Promise<number> {
    try {
      const row = await this.database.emailVerificationCode.update({
        where: { userId },
        data: { attempts: { increment: 1 } },
      });
      return row.attempts;
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw invalidVerificationCodeError();
      }
      throw error;
    }
  }

  discard(userId: string): Prisma.PrismaPromise<Prisma.BatchPayload> {
    return this.database.emailVerificationCode.deleteMany({
      where: { userId },
    });
  }

  // Silent when nothing is sent (no account, verified, cooling down, capped):
  // a 429 would confirm an unverified account. The client runs its own timer.
  async resend(email: string): Promise<void> {
    const user = await this.database.user.findUnique({
      where: { email },
      include: { emailVerificationCode: true },
    });
    if (!user || !needsEmailVerification(user)) {
      return;
    }
    const sent = user.emailVerificationCode;
    if (sent && (isCoolingDown(sent.lastSentAt) || isCapped(sent))) {
      return;
    }
    await this.issue(user);
  }

  private hash(userId: string, code: string): string {
    return createHmac('sha256', this.secret)
      .update(`${userId}:${code}`)
      .digest('hex');
  }

  private matches(codeHash: string, userId: string, code: string): boolean {
    return timingSafeEqual(
      Buffer.from(codeHash, 'hex'),
      Buffer.from(this.hash(userId, code), 'hex'),
    );
  }
}

function isNewDay(windowStartedAt: Date): boolean {
  return Date.now() - windowStartedAt.getTime() >= DAY_MS;
}

function isCoolingDown(lastSentAt: Date): boolean {
  return Date.now() - lastSentAt.getTime() < RESEND_COOLDOWN_MS;
}

function isCapped(sent: { sendCount: number; sendWindowStartedAt: Date }) {
  return (
    !isNewDay(sent.sendWindowStartedAt) && sent.sendCount >= MAX_CODES_PER_DAY
  );
}
