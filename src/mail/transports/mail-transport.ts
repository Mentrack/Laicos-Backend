import type { RenderedEmail } from '../templates';

export interface MailTransport {
  /** Throws PermanentSendError for failures a retry cannot fix. */
  send(from: string, to: string, email: RenderedEmail): Promise<void>;
  verify(): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
