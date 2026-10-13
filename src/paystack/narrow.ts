import { isRecord } from '../common/narrow';
import { PaystackError } from './paystack-error';

type Source = Record<string, unknown>;

function malformed(what: string) {
  return new PaystackError(`Malformed Paystack response: ${what}`, null);
}

export function record(value: unknown, what: string): Source {
  if (!isRecord(value)) {
    throw malformed(what);
  }
  return value;
}

export function text(source: Source, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !value) {
    throw malformed(key);
  }
  return value;
}

export function optionalText(source: Source, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value ? value : null;
}

export function integer(source: Source, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw malformed(key);
  }
  return value;
}

// Paystack ids are numbers; we store them as text.
export function identifier(source: Source, key: string): string {
  const value = source[key];
  if (typeof value === 'number' && Number.isInteger(value)) {
    return String(value);
  }
  return text(source, key);
}

export function optionalIdentifier(source: Source, key: string): string | null {
  return source[key] === undefined || source[key] === null
    ? null
    : identifier(source, key);
}
