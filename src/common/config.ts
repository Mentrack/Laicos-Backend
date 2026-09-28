import { ConfigService } from '@nestjs/config';

export function requireConfig(config: ConfigService, key: string): string {
  const value = config.getOrThrow<string>(key).trim();
  if (!value) {
    throw new Error(`${key} must not be blank`);
  }
  return value;
}
