import { auth, gmail, type gmail_v1 } from '@googleapis/gmail';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import MailComposer from 'nodemailer/lib/mail-composer';
import { requireConfig } from '../../common/config';
import { PermanentSendError } from '../../common/permanent-send-error';
import type { RenderedEmail } from '../templates';
import type { MailTransport } from './mail-transport';

// gaxios sets no timeout by default, so a hung request would hold a
// notification worker slot (or an auth request) for undici's 5 minutes.
const REQUEST_TIMEOUT_MS = 15_000;

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }
  if (
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    typeof error.response.status === 'number'
  ) {
    return error.response.status;
  }
  return undefined;
}

/** Sends over HTTPS because Railway blocks outbound SMTP. */
export class GmailApiTransport implements MailTransport {
  private readonly logger = new Logger(GmailApiTransport.name);
  private readonly oauth: InstanceType<typeof auth.OAuth2>;
  private readonly api: gmail_v1.Gmail;

  constructor(config: ConfigService) {
    this.oauth = new auth.OAuth2({
      clientId: requireConfig(config, 'GMAIL_CLIENT_ID'),
      clientSecret: requireConfig(config, 'GMAIL_CLIENT_SECRET'),
      transporterOptions: { timeout: REQUEST_TIMEOUT_MS },
    });
    this.oauth.setCredentials({
      refresh_token: requireConfig(config, 'GMAIL_REFRESH_TOKEN'),
    });
    this.api = gmail({ version: 'v1', auth: this.oauth });
  }

  async send(from: string, to: string, email: RenderedEmail): Promise<void> {
    const mime = await new MailComposer({ from, to, ...email })
      .compile()
      .build();
    // Fetched apart from the send: a token-endpoint 400 (invalid_grant) must
    // stay temporary, while a 400 from messages.send means a bad message.
    try {
      await this.oauth.getAccessToken();
    } catch (error) {
      this.logRevokedToken();
      throw error;
    }
    try {
      await this.api.users.messages.send(
        { userId: 'me', requestBody: { raw: mime.toString('base64url') } },
        { timeout: REQUEST_TIMEOUT_MS },
      );
    } catch (error) {
      const status = httpStatus(error);
      if (status === 400) {
        throw new PermanentSendError(
          error instanceof Error ? error.message : 'Gmail rejected the message',
        );
      }
      if (status === 401 || status === 403) {
        this.logRevokedToken();
      }
      throw error;
    }
  }

  private logRevokedToken(): void {
    this.logger.error(
      'Gmail rejected our credentials; refresh token likely revoked; mint a new one (README)',
    );
  }

  async verify(): Promise<void> {
    await this.oauth.getAccessToken();
  }
}
