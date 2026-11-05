import type { Queue } from 'bullmq';
import { DELIVER_JOB, NotificationQueue } from '../notification-queue';

describe('NotificationQueue', () => {
  const queue = { getJob: jest.fn(), addBulk: jest.fn() };
  const notificationQueue = new NotificationQueue(queue as unknown as Queue);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('adds one deliver job per delivery, keyed by its id, in one bulk call', async () => {
    queue.getJob.mockResolvedValue(undefined);
    await notificationQueue.enqueue(['d1', 'd2']);
    expect(queue.addBulk).toHaveBeenCalledTimes(1);
    expect(queue.addBulk).toHaveBeenCalledWith([
      { name: DELIVER_JOB, data: { deliveryId: 'd1' }, opts: { jobId: 'd1' } },
      { name: DELIVER_JOB, data: { deliveryId: 'd2' }, opts: { jobId: 'd2' } },
    ]);
  });

  it('looks every job up at once instead of one round trip at a time', async () => {
    const pending: Array<(job: undefined) => void> = [];
    queue.getJob.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const done = notificationQueue.enqueue(['d1', 'd2', 'd3']);
    await Promise.resolve();
    expect(queue.getJob).toHaveBeenCalledTimes(3);
    pending.forEach((resolve) => resolve(undefined));
    await done;
  });

  it('does nothing for an empty list', async () => {
    await notificationQueue.enqueue([]);
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  it.each(['failed', 'completed'])(
    'removes a %s job first so the id can be reused',
    async (state) => {
      const order: string[] = [];
      const job = {
        getState: jest.fn().mockResolvedValue(state),
        remove: jest.fn(() => {
          order.push('remove');
          return Promise.resolve();
        }),
      };
      queue.getJob.mockResolvedValue(job);
      queue.addBulk.mockImplementation(() => {
        order.push('add');
        return Promise.resolve();
      });
      await notificationQueue.enqueue(['d1']);
      expect(order).toEqual(['remove', 'add']);
    },
  );

  it('leaves a waiting or delayed job alone', async () => {
    const job = {
      getState: jest.fn().mockResolvedValue('delayed'),
      remove: jest.fn(),
    };
    queue.getJob.mockResolvedValue(job);
    await notificationQueue.enqueue(['d1']);
    expect(job.remove).not.toHaveBeenCalled();
    expect(queue.addBulk).toHaveBeenCalledTimes(1);
  });
});
