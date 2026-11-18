import { Injectable, Logger } from '@nestjs/common';
import { AuditActorType, CheckoutStatus } from '../../generated/client';
import { advisoryLock } from '../common/advisory-lock';
import { PrismaService } from '../prisma/prisma.service';
import { lapseSourcedCheckout } from '../sourcing-request/utils/sync-sourcing-request';
import { lockCheckout } from './utils/checkout-lock';
import { CHECKOUT_TRANSACTION } from './utils/checkout-transaction';
import { releaseCheckout } from './utils/release-checkout';

// Bounds one sweep; the next run (a minute later) takes the rest.
const SWEEP_BATCH = 100;

@Injectable()
export class CheckoutExpiryService {
  private readonly logger = new Logger(CheckoutExpiryService.name);

  constructor(private readonly database: PrismaService) {}

  /** Releases unpaid checkouts past their hold; returns how many. */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const overdue = await this.database.checkout.findMany({
      where: {
        status: CheckoutStatus.AWAITING_PAYMENT,
        expiresAt: { lt: now },
      },
      select: { id: true, sourcingRequestId: true },
      orderBy: { expiresAt: 'asc' },
      take: SWEEP_BATCH,
    });
    let expired = 0;
    for (const { id, sourcingRequestId } of overdue) {
      // One bad checkout mustn't hold every other buyer's stock hostage.
      try {
        if (await this.expire(id, sourcingRequestId, now)) {
          expired++;
        }
      } catch (error) {
        this.logger.error(
          `Could not expire checkout ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return expired;
  }

  private expire(id: string, sourcingRequestId: string | null, now: Date) {
    return this.database.$transaction(async (tx) => {
      // Sourcing flows (sign, back) lock the request and then touch its
      // checkouts, so take the locks in that order or the two can deadlock.
      // The request id comes from the scan: it never changes on a checkout.
      if (sourcingRequestId) {
        await advisoryLock(tx, `sourcing:${sourcingRequestId}`);
      }
      await lockCheckout(tx, id);
      // Re-read under the lock: it may have been paid or cancelled since the
      // scan.
      const checkout = await tx.checkout.findUnique({ where: { id } });
      if (
        !checkout ||
        checkout.status !== CheckoutStatus.AWAITING_PAYMENT ||
        checkout.expiresAt >= now
      ) {
        return false;
      }
      await releaseCheckout(
        tx,
        id,
        CheckoutStatus.EXPIRED,
        'Payment not received',
        { type: AuditActorType.SYSTEM, userId: null },
      );
      if (checkout.sourcingRequestId) {
        await lapseSourcedCheckout(tx, checkout.sourcingRequestId, {
          actorType: AuditActorType.SYSTEM,
          actorUserId: null,
          title: 'Payment window lapsed',
          summary: 'Payment not received',
        });
      }
      return true;
    }, CHECKOUT_TRANSACTION);
  }
}
