import type { Prisma } from '../../../generated/client';

export interface DeliveryTarget {
  userId: string;
  email: string;
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  emailSubject: string | null;
  emailHtml: string | null;
  emailText: string | null;
}

export type ChannelOutcome = 'SENT' | 'SKIPPED';

export interface ChannelAdapter {
  send(target: DeliveryTarget): Promise<ChannelOutcome>;
}
