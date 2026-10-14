import { ConfigService } from '@nestjs/config';
import { redisConnection, webappOrigins, webappUrl } from '../config';

const config = new ConfigService({
  FRONTEND_WEBAPP_URL: ' https://app.laicos.ng/ , http://localhost:3000 ,',
});

describe('webapp config', () => {
  it('lists every allowed origin, trimmed', () => {
    expect(webappOrigins(config)).toEqual([
      'https://app.laicos.ng/',
      'http://localhost:3000',
    ]);
  });

  it('builds links on the first origin', () => {
    expect(webappUrl(config, '/login')).toBe('https://app.laicos.ng/login');
  });
});

describe('redisConnection', () => {
  it('reads host, port and password', () => {
    const config = new ConfigService({
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'secret',
    });
    expect(redisConnection(config)).toEqual({
      host: 'redis.internal',
      port: 6380,
      password: 'secret',
    });
  });

  it('refuses a non-integer port', () => {
    const config = new ConfigService({
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: 'six',
      REDIS_PASSWORD: 'secret',
    });
    expect(() => redisConnection(config)).toThrow(
      'REDIS_PORT must be an integer',
    );
  });
});
