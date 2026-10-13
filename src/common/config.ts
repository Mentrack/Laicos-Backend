import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/client';

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

// A blank optional value takes the fallback; with no fallback it is required.
function valueOrFallback(
  config: ConfigService,
  key: string,
  fallback: string | undefined,
): string {
  const value = config.get<string>(key)?.trim();
  if (value) {
    return value;
  }
  return fallback ?? requireConfig(config, key);
}

export function wholeNumberConfig(
  config: ConfigService,
  key: string,
  min: number,
  fallback?: number,
): number {
  const value = Number(valueOrFallback(config, key, fallback?.toString()));
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be a whole number of at least ${min}`);
  }
  return value;
}

export function percentConfig(
  config: ConfigService,
  key: string,
  max: number,
  fallback?: string,
): Prisma.Decimal {
  const value = valueOrFallback(config, key, fallback);
  if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > max) {
    throw new Error(
      `${key} must be a percentage from 0 to ${max} with at most 2 decimals`,
    );
  }
  return new Prisma.Decimal(value);
}
