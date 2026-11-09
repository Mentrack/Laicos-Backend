import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '../../generated/client';
import { webappUrl } from '../common/config';
import { MailService } from '../mail/mail.service';
import {
  accountVerifiedEmail,
  farmRejectedEmail,
  farmerInviteEmail,
} from '../mail/templates';
import { passwordResetUrl } from './utils/password-reset-url';

/** Emails a farmer the outcome of their farm's verification. */
@Injectable()
export class FarmerInviteService {
  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /**
   * `resetLink` is set only for an onboarded farmer, who has no sign-in yet.
   * Everyone else already signs in and is told they have full access.
   */
  async sendInvite(user: User, resetLink: string | null) {
    await this.mail.send(
      user.email,
      resetLink
        ? farmerInviteEmail({
            firstName: user.firstName,
            setPasswordUrl: passwordResetUrl(this.config, resetLink),
          })
        : accountVerifiedEmail({
            firstName: user.firstName,
            loginUrl: webappUrl(this.config, '/login'),
          }),
    );
  }

  async sendRejection(user: User, farmName: string, reason: string) {
    await this.mail.send(
      user.email,
      farmRejectedEmail({ firstName: user.firstName, farmName, reason }),
    );
  }
}
