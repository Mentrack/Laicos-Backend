import { ConfigService } from '@nestjs/config';
import { requireConfig } from '../../common/config';
import { GmailApiTransport } from './gmail-api.transport';
import type { MailTransport } from './mail-transport';
import { SmtpTransport } from './smtp.transport';

export function createMailTransport(config: ConfigService): MailTransport {
  switch (requireConfig(config, 'MAIL_TRANSPORT')) {
    case 'gmail':
      return new GmailApiTransport(config);
    case 'smtp':
      return new SmtpTransport(config);
    default:
      throw new Error('MAIL_TRANSPORT must be gmail or smtp');
  }
}
