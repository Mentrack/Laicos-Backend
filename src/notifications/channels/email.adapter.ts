import { Injectable } from '@nestjs/common';
import { PermanentSendError } from '../../common/permanent-send-error';
import { MailService } from '../../mail/mail.service';
import {
  ChannelAdapter,
  ChannelOutcome,
  DeliveryTarget,
} from './channel-adapter';

@Injectable()
export class EmailChannelAdapter implements ChannelAdapter {
  constructor(private readonly mail: MailService) {}

  async send(target: DeliveryTarget): Promise<ChannelOutcome> {
    const { email, emailSubject, emailHtml, emailText } = target;
    if (!email) return 'SKIPPED';
    // The DB CHECK forbids this state, so reaching it is a bug, not a skip.
    if (!emailSubject || !emailHtml || !emailText) {
      throw new PermanentSendError('EMAIL delivery has no rendered email');
    }
    await this.mail.send(email, {
      subject: emailSubject,
      html: emailHtml,
      text: emailText,
    });
    return 'SENT';
  }
}
