import { ConflictException } from '@nestjs/common';

export class PaystackError extends Error {
  constructor(
    message: string,
    // Paystack's HTTP status; null when it was unreachable or the body was malformed.
    readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

// Only a 4xx proves Paystack refused. Anything else (unreachable, a 408
// timeout, a 5xx, a malformed 200) means it may have acted.
export function isDefiniteRejection(error: PaystackError): boolean {
  const { httpStatus } = error;
  return (
    httpStatus !== null &&
    httpStatus >= 400 &&
    httpStatus < 500 &&
    httpStatus !== 408
  );
}

// A 409, not a 502: HttpExceptionFilter hides every 5xx code, and the client
// needs this one to know a retry may work.
export function providerUnavailable() {
  return new ConflictException({
    message: 'The payment provider is unavailable; please try again',
    code: 'PAYMENT_PROVIDER_UNAVAILABLE',
  });
}

export async function orProviderUnavailable<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PaystackError) {
      throw providerUnavailable();
    }
    throw error;
  }
}
