import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { requireConfig } from '../../common/config';
import type { RenderedEmail } from '../templates';
import type { MailTransport } from './mail-transport';

/** Local only (MailHog): Railway blocks outbound SMTP, so deployed envs use Gmail's API. */
export class SmtpTransport implements MailTransport {
  private readonly mailer: Transporter;

  constructor(config: ConfigService) {
    const host = requireConfig(config, 'SMTP_HOST');
    const port = Number(requireConfig(config, 'SMTP_PORT'));
    if (!Number.isInteger(port)) {
      throw new Error('SMTP_PORT must be a number');
    }
    // Both or neither: MailHog takes no auth, Gmail needs both.
    const user = config.get<string>('SMTP_USER')?.trim();
    const pass = config.get<string>('SMTP_PASS')?.trim();
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error('Set SMTP_USER and SMTP_PASS together, or neither');
    }
    this.mailer = createTransport({
      host,
      port,
      // 465 is implicit TLS; other ports upgrade with STARTTLS if offered.
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async send(from: string, to: string, email: RenderedEmail): Promise<void> {
    await this.mailer.sendMail({ from, to, ...email });
  }

  async verify(): Promise<void> {
    await this.mailer.verify();
  }
}
