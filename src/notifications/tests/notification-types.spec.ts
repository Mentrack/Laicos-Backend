import { NotificationChannel, Role } from '../../../generated/client';
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
