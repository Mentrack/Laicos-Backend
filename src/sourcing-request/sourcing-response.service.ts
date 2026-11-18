import { Injectable, Logger } from '@nestjs/common';
import { SourcingRequestStatus } from '../../generated/client';
import { advisoryLock } from '../common/advisory-lock';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { SourcingConfig } from './sourcing-config';
import { returnToPending } from './utils/sourcing-decline';

// Bounds one sweep; the next run (a minute later) takes the rest.
const SWEEP_BATCH = 100;
const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class SourcingResponseService {
  private readonly logger = new Logger(SourcingResponseService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly config: SourcingConfig,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /** Returns requests the agent never answered to the pool; returns how many. */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.config.responseHours * HOUR_MS,
    );
    const overdue = await this.database.sourcingRequest.findMany({
      where: {
        status: SourcingRequestStatus.ASSIGNED,
        assignedAt: { lt: cutoff },
      },
      select: { id: true },
      orderBy: { assignedAt: 'asc' },
      take: SWEEP_BATCH,
    });
    let expired = 0;
    for (const { id } of overdue) {
      // One bad request mustn't stop the rest of the batch.
      try {
        if (await this.expire(id, cutoff)) {
          expired++;
        }
      } catch (error) {
        this.logger.error(
          `Could not expire sourcing request ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return expired;
  }

  private async expire(id: string, cutoff: Date): Promise<boolean> {
    const deliveryIds = await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `sourcing:${id}`);
      // Re-read under the lock: the agent may have accepted since the scan.
      const request = await tx.sourcingRequest.findUnique({
        where: { id },
        include: { buyer: { select: { userId: true } } },
      });
      if (
        !request ||
        request.status !== SourcingRequestStatus.ASSIGNED ||
        !request.assignedAt ||
        request.assignedAt >= cutoff
      ) {
        return null;
      }
      return returnToPending(
        tx,
        {
          notifications: this.notifications,
          audit: this.audit,
          responseHours: this.config.responseHours,
        },
        request,
        null,
        null,
      );
    });
    if (!deliveryIds) {
      return false;
    }
    void this.notifications.dispatch(deliveryIds);
    return true;
  }
}
