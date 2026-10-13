export const PAYSTACK_EVENTS_QUEUE = 'paystack-events';

export type PaystackEvent = {
  event: string;
  data: Record<string, unknown>;
};
