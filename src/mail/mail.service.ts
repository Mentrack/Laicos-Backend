import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requireConfig } from '../common/config';
import type { RenderedEmail } from './templates';
import {
  MAIL_TRANSPORT,
  type MailTransport,
} from './transports/mail-transport';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;

  constructor(
    config: ConfigService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {
    this.from = requireConfig(config, 'MAIL_FROM');
  }

  // Missing settings still fail the boot (constructor). A refused connection
  // only logs: email is not worth taking the whole API down, but it must be
  // loud, or bad credentials surface only when an invite never arrives.
  async onModuleInit(): Promise<void> {
    try {
      await this.transport.verify();
    } catch (error) {
      this.logger.error(
        `Mail transport check failed; emails will not send until fixed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async send(to: string, email: RenderedEmail): Promise<void> {
    await this.transport.send(this.from, to, email);
  }
}
