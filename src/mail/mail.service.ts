import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { requireConfig } from '../common/config';
import type { RenderedEmail } from './templates';

/** SMTP: Gmail (with an app password) in deployed envs, MailHog locally. */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = requireConfig(config, 'SMTP_HOST');
    const port = Number(requireConfig(config, 'SMTP_PORT'));
    if (!Number.isInteger(port)) {
      throw new Error('SMTP_PORT must be a number');
    }
    this.from = requireConfig(config, 'MAIL_FROM');
    // Both or neither: MailHog takes no auth, Gmail needs both.
    const user = config.get<string>('SMTP_USER')?.trim();
    const pass = config.get<string>('SMTP_PASS')?.trim();
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error('Set SMTP_USER and SMTP_PASS together, or neither');
    }
    this.transport = createTransport({
      host,
      port,
      // 465 is implicit TLS; other ports upgrade with STARTTLS if offered.
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  // Missing settings still fail the boot (constructor). A refused connection
  // only logs: email is not worth taking the whole API down, but it must be
  // loud, or bad credentials surface only when an invite never arrives.
  async onModuleInit(): Promise<void> {
    try {
      await this.transport.verify();
    } catch (error) {
      this.logger.error(
        `SMTP check failed; emails will not send until fixed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async send(to: string, email: RenderedEmail): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, ...email });
  }
}
