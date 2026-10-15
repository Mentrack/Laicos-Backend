import { Injectable, Logger } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  CheckoutStatus,
} from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  recordLinkedAudit,
  syncSourcingRequest,
} from '../sourcing-request/utils/sync-sourcing-request';
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
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: SWEEP_BATCH,
    });
    let expired = 0;
    for (const { id } of overdue) {
      // One bad checkout mustn't hold every other buyer's stock hostage.
      try {
        if (await this.expire(id, now)) {
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

  private expire(id: string, now: Date) {
    return this.database.$transaction(async (tx) => {
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
      );
      if (checkout.sourcingRequestId) {
        await syncSourcingRequest(tx, checkout.sourcingRequestId);
        await recordLinkedAudit(tx, {
          actorType: AuditActorType.SYSTEM,
          farmerId: null,
          agentId: null,
          farmId: null,
          category: AuditCategory.ORDER,
          title: 'Checkout expired',
          summary: 'Payment not received',
          actionLabel: 'View request',
          resource: AuditResource.SOURCING_REQUEST,
          resourceId: checkout.sourcingRequestId,
          sourcingRequestId: checkout.sourcingRequestId,
        });
      }
      return true;
    }, CHECKOUT_TRANSACTION);
  }
}
