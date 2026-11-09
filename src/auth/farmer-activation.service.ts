import { Injectable, Logger } from '@nestjs/common';
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
      // Google and anyone who chose a password at signup keep it. An
      // onboarded farmer has neither provider, so they get a link to set one.
      const account = await this.firebase.auth.getUser(user.firebaseUid);
      const hasSignIn = account.providerData.some(
        (provider) =>
          provider.providerId === 'google.com' ||
          provider.providerId === 'password',
      );
      // Claimed first, so two farms approved at once can't each send a link.
      const { count } = await this.database.user.updateMany({
        where: { id: userId, role: Role.FARMER, activatedAt: null },
        data: { activatedAt: new Date() },
      });
      if (!count) {
        return;
      }
      const resetLink = hasSignIn
        ? null
        : await this.firebase.generatePasswordResetLink(user.email);
      if (!hasSignIn && !resetLink) {
        throw new Error(`No set-password link for farmer ${userId}`);
      }
      // A failed email keeps the activation: the farmer can still get in
      // through forgot-password, which works once they are active.
      await this.invites.sendInvite(user, resetLink);
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
}
