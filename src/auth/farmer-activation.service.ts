import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Role } from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { FarmerInviteService } from './farmer-invite.service';
import { FirebaseService } from './firebase/firebase.service';

/**
 * Gives a farmer access once their first farm is verified, and tells them
 * the outcome of a round. Called after the round's transaction commits, so
 * these never throw: a failure is logged rather than failing a decision
 * that already stands.
 */
@Injectable()
export class FarmerActivationService {
  private readonly logger = new Logger(FarmerActivationService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly firebase: FirebaseService,
    private readonly invites: FarmerInviteService,
  ) {}

  async activate(userId: string): Promise<void> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      return;
    }
    try {
      // A Google account signs in with Google; anything else has no
      // password until this one.
      const account = await this.firebase.auth.getUser(user.firebaseUid);
      const password = account.providerData.some(
        (provider) => provider.providerId === 'google.com',
      )
        ? null
        : temporaryPassword();
      // Claimed before touching Firebase, so two farms approved at once
      // can't each set (and send) a different password.
      const { count } = await this.database.user.updateMany({
        where: { id: userId, role: Role.FARMER, activatedAt: null },
        data: {
          activatedAt: new Date(),
          mustChangePassword: Boolean(password),
        },
      });
      if (!count) {
        return;
      }
      if (password) {
        await this.setPassword(userId, user.firebaseUid, password);
      }
      // A failed email keeps the activation: the farmer can still get in
      // through forgot-password, which works once they are active.
      await this.invites.sendInvite(user, password);
    } catch (error) {
      this.logger.error(
        `Failed to activate farmer ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async notifyRejection(
    userId: string,
    farmName: string,
    reason: string,
  ): Promise<void> {
    try {
      const user = await this.database.user.findUnique({
        where: { id: userId },
      });
      if (user) {
        await this.invites.sendRejection(user, farmName, reason);
      }
    } catch (error) {
      this.logger.error(
        `Failed to notify farmer ${userId} of a rejection`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Undoes the claim on failure, leaving the farmer as they were. */
  private async setPassword(
    userId: string,
    firebaseUid: string,
    password: string,
  ): Promise<void> {
    try {
      await this.firebase.auth.updateUser(firebaseUid, { password });
    } catch (error) {
      await this.database.user.update({
        where: { id: userId },
        data: { activatedAt: null, mustChangePassword: false },
      });
      throw error;
    }
  }
}

/** 12 URL-safe characters (72 bits); one per farmer, never a shared default. */
function temporaryPassword(): string {
  return randomBytes(9).toString('base64url');
}
