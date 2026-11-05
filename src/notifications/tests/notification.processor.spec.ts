import { isRecord } from '../../common/narrow';
import { NotificationProcessor } from '../notification.processor';

describe('NotificationProcessor', () => {
  it('runs several jobs at once so one slow send cannot stall the queue', () => {
    // The key @nestjs/bullmq reads worker options from; it is not exported.
    const options: unknown = Reflect.getMetadata(
      'bullmq:worker_metadata',
      NotificationProcessor,
    );
    const concurrency = isRecord(options) ? options.concurrency : undefined;
    expect(concurrency).toEqual(expect.any(Number));
    expect(Number(concurrency)).toBeGreaterThan(1);
  });
});
