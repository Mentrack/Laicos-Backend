import { ConfigService } from '@nestjs/config';
import { webappOrigins, webappUrl } from '../config';

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
