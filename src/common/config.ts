import { ConfigService } from '@nestjs/config';

export function requireConfig(config: ConfigService, key: string): string {
  const value = config.getOrThrow<string>(key).trim();
  if (!value) {
    throw new Error(`${key} must not be blank`);
  }
  return value;
}

/** The CORS allowlist: comma-separated, no wildcard. */
export function webappOrigins(config: ConfigService): string[] {
  return requireConfig(config, 'FRONTEND_WEBAPP_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** This API's public origin. BASE_URL is optional, and blank means local dev. */
export function apiBaseUrl(config: ConfigService): string {
  const baseUrl = config.get<string>('BASE_URL')?.trim();
  if (baseUrl) {
    return baseUrl.replace(/\/$/, '');
  }
  return `http://localhost:${config.get<string>('PORT') ?? 8080}`;
}

/** A webapp link for emails; the first allowed origin is the live webapp. */
export function webappUrl(config: ConfigService, path: string): string {
  return `${webappOrigins(config)[0].replace(/\/$/, '')}${path}`;
}
