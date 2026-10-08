import { ConflictException } from '@nestjs/common';
import { isTransactionTimeout } from '../../common/prisma-errors';

// Up to 50 items at ~3 statements each, plus time queued on the cart or
// checkout lock or on other buyers' produce row locks, can outrun Prisma's 5s
// default and surface as a bare 500.
export const CHECKOUT_TRANSACTION = { timeout: 15_000, maxWait: 5_000 };

export async function busyAsConflict<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    // Rolled back, so retrying (with the same key, where there is one) is
    // safe. A 409 rather than a 503: HttpExceptionFilter hides every 5xx
    // behind a generic message, and the client needs this code to retry.
    if (isTransactionTimeout(error)) {
      throw new ConflictException({
        message: 'Checkout is busy; please try again',
        code: 'CHECKOUT_BUSY',
      });
    }
    throw error;
  }
}
