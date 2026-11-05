import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationQueryDto } from '../dto/notification-query.dto';
import { RegisterDeviceDto } from '../dto/register-device.dto';

const check = (input: object) =>
  validate(plainToInstance(RegisterDeviceDto, input));

describe('RegisterDeviceDto', () => {
  it.each(['ExponentPushToken[abc]', 'ExpoPushToken[abc]'])(
    'accepts %s',
    async (token) => {
      expect(await check({ token, platform: 'IOS' })).toHaveLength(0);
    },
  );

  it.each(['abc', 'ExponentPushToken[]'])('rejects token %s', async (token) => {
    expect(await check({ token, platform: 'IOS' })).not.toHaveLength(0);
  });

  it('rejects an unsupported platform', async () => {
    const errors = await check({
      token: 'ExpoPushToken[abc]',
      platform: 'WEB',
    });
    expect(errors.map((e) => e.property)).toEqual(['platform']);
  });
});

describe('NotificationQueryDto', () => {
  const parse = async (input: object) => {
    const dto = plainToInstance(NotificationQueryDto, input);
    return { dto, errors: await validate(dto) };
  };

  it.each([
    ['true', true],
    ['false', false],
    [true, true],
    [false, false],
  ])('reads unread=%p as %p', async (raw, expected) => {
    const { dto, errors } = await parse({ unread: raw });
    expect(errors).toHaveLength(0);
    expect(dto.unread).toBe(expected);
  });

  it('rejects anything else', async () => {
    const { errors } = await parse({ unread: 'yes' });
    expect(errors.map((e) => e.property)).toEqual(['unread']);
  });

  it('allows it to be omitted', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toHaveLength(0);
    expect(dto.unread).toBeUndefined();
  });
});
