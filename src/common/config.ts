import { ConfigService } from '@nestjs/config';

/**
 * A required env var, trimmed. `getOrThrow` only rejects undefined, so a blank
 * value would otherwise boot and fail later with an opaque downstream error.
 */
export function requireConfig(config: ConfigService, key: string): string {
  const value = config.getOrThrow<string>(key).trim();
  if (!value) {
    throw new Error(`${key} must not be blank`);
  }
  return value;
}
