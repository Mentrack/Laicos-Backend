import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '../../generated/client';
import { webappUrl } from '../common/config';
import { MailService } from '../mail/mail.service';
import {
  farmRejectedEmail,
  farmerInviteEmail,
  farmerVerifiedGoogleEmail,
} from '../mail/templates';

/** Emails a farmer the outcome of their farm's verification. */
@Injectable()
export class FarmerInviteService {
  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /** `temporaryPassword` is null for a Google account, which has none. */
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
        : farmerVerifiedGoogleEmail({ firstName: user.firstName, loginUrl }),
    );
  }

  async sendRejection(user: User, farmName: string, reason: string) {
    await this.mail.send(
      user.email,
      farmRejectedEmail({ firstName: user.firstName, farmName, reason }),
    );
  }
}
