import { PushPlatform } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { DeviceService } from '../device.service';

describe('DeviceService', () => {
  const pushDevice = { upsert: jest.fn(), deleteMany: jest.fn() };
  const service = new DeviceService({ pushDevice } as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('upserts on token so the latest registrant owns it', async () => {
    await service.register('user-1', {
      token: 'ExponentPushToken[abc]',
      platform: PushPlatform.IOS,
    });
    expect(pushDevice.upsert).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[abc]' },
      create: {
        userId: 'user-1',
        token: 'ExponentPushToken[abc]',
        platform: PushPlatform.IOS,
      },
      update: {
        userId: 'user-1',
        platform: PushPlatform.IOS,
        lastSeenAt: expect.any(Date),
      },
    });
  });

  it('unregisters only the caller token and tolerates no match', async () => {
    pushDevice.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.unregister('user-1', 'ExponentPushToken[abc]'),
    ).resolves.toBeUndefined();
    expect(pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[abc]', userId: 'user-1' },
    });
  });
});
