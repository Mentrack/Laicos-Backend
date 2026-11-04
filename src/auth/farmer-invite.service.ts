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

/** Emails a farmer the outcome of their farm's verification. */
@Injectable()
export class FarmerInviteService {
  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /**
   * `temporaryPassword` is set only for an onboarded farmer, who had none.
   * Everyone else already signs in and is told they have full access.
   */
  async sendInvite(user: User, temporaryPassword: string | null) {
    const loginUrl = webappUrl(this.config, '/login');
    await this.mail.send(
      user.email,
      temporaryPassword
        ? farmerInviteEmail({
            firstName: user.firstName,
            email: user.email,
            temporaryPassword,
            loginUrl,
          })
        : accountVerifiedEmail({ firstName: user.firstName, loginUrl }),
    );
  }

  async sendRejection(user: User, farmName: string, reason: string) {
    await this.mail.send(
      user.email,
      farmRejectedEmail({ firstName: user.firstName, farmName, reason }),
    );
  }
}
