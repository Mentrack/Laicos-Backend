import { Currency, NotificationChannel, Role } from '../../../generated/client';
import { NOTIFICATION_TYPES } from '../notification-types';

const params = { orderId: 'o1', produceName: 'Maize' };
const recipient = (role: Role) => ({
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  role,
});

describe('NOTIFICATION_TYPES', () => {
  const def = NOTIFICATION_TYPES.ORDER_RECEIVED;

  it('notifies ORDER_RECEIVED on push and email', () => {
    expect(def.channels).toEqual([
      NotificationChannel.PUSH,
      NotificationChannel.EMAIL,
    ]);
  });

  it('tells a farmer about an order on their farm', () => {
    const out = def.render(params, recipient(Role.FARMER));
    expect(out.title).toBe('New order');
    expect(out.body).toBe('A buyer ordered Maize from your farm.');
    expect(out.data).toEqual({ resource: 'ORDER', resourceId: 'o1' });
    expect(out.email.subject).toBe('New order: Maize');
    expect(out.email.text.startsWith('Hi Ada,')).toBe(true);
  });

  it('tells an agent about an order on a farm they manage', () => {
    const out = def.render(params, recipient(Role.EXTENSION_AGENT));
    expect(out.body).toBe('A buyer ordered Maize from a farm you manage.');
  });
});

describe('NOTIFICATION_TYPES for delivery, disputes and money', () => {
  const buyer = recipient(Role.BUYER);
  const rendered = {
    ORDER_SHIPPED: NOTIFICATION_TYPES.ORDER_SHIPPED.render(
      { orderId: 'o1', orderNumber: 'ORD-000001', produceName: 'Maize' },
      buyer,
    ),
    DISPUTE_RAISED: NOTIFICATION_TYPES.DISPUTE_RAISED.render(
      {
        disputeId: 'd1',
        orderId: 'o1',
        orderNumber: 'ORD-000001',
        reason: 'Spoiled <b>goods</b>',
      },
      buyer,
    ),
    DISPUTE_RESOLVED: NOTIFICATION_TYPES.DISPUTE_RESOLVED.render(
      {
        disputeId: 'd1',
        orderId: 'o1',
        orderNumber: 'ORD-000001',
        refundPercent: '40',
      },
      buyer,
    ),
    REFUND_PROCESSED: NOTIFICATION_TYPES.REFUND_PROCESSED.render(
      { refundId: 'r1', amount: '1500.00', currency: Currency.NGN },
      buyer,
    ),
    PAYOUT_PAID: NOTIFICATION_TYPES.PAYOUT_PAID.render(
      { payoutId: 'p1', reference: 'PO-000001', amount: '9000.00' },
      buyer,
    ),
  };

  it.each(Object.keys(rendered) as (keyof typeof rendered)[])(
    '%s goes out on push and email with a greeting',
    (type) => {
      expect(NOTIFICATION_TYPES[type].channels).toEqual([
        NotificationChannel.PUSH,
        NotificationChannel.EMAIL,
      ]);
      const out = rendered[type];
      expect(out.title).not.toBe('');
      expect(out.body).not.toBe('');
      expect(out.email.subject).not.toBe('');
      expect(out.email.text.startsWith('Hi Ada,')).toBe(true);
      expect(out.email.html).toContain('Hi Ada,');
    },
  );

  it.each([
    ['ORDER_SHIPPED', { resource: 'ORDER', resourceId: 'o1' }],
    ['DISPUTE_RAISED', { resource: 'DISPUTE', resourceId: 'd1' }],
    ['DISPUTE_RESOLVED', { resource: 'DISPUTE', resourceId: 'd1' }],
    ['REFUND_PROCESSED', { resource: 'REFUND', resourceId: 'r1' }],
    ['PAYOUT_PAID', { resource: 'PAYOUT', resourceId: 'p1' }],
  ] as const)('%s points at its resource', (type, data) => {
    expect(rendered[type].data).toEqual(data);
  });

  it('asks the buyer to confirm delivery or report a problem', () => {
    const out = rendered.ORDER_SHIPPED;
    expect(out.body).toContain('Maize');
    expect(out.email.text).toMatch(/confirm/i);
    expect(out.email.text).toMatch(/problem/i);
  });

  it('escapes the dispute reason in the email', () => {
    expect(rendered.DISPUTE_RAISED.email.html).not.toContain('<b>goods</b>');
    expect(rendered.DISPUTE_RAISED.email.html).toContain('&lt;b&gt;');
  });

  it('states the refund share, amount and payout', () => {
    expect(rendered.DISPUTE_RESOLVED.body).toContain('40%');
    expect(rendered.REFUND_PROCESSED.body).toContain('1500.00');
    expect(rendered.REFUND_PROCESSED.body).toContain('NGN');
    expect(rendered.PAYOUT_PAID.body).toContain('PO-000001');
    expect(rendered.PAYOUT_PAID.body).toContain('9000.00');
  });
});
