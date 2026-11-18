import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  AuditActorType,
  FarmVerificationStatus,
  PackagingType,
  ProduceCondition,
  ProduceStatus,
  QualityGrade,
  Role,
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
  type Agent,
  type Buyer,
  type Farm,
  type Farmer,
  type Lga,
  type State,
  type User,
} from '../generated/client';
import { AuditService } from '../src/audit/audit.service';
import { addDays, lagosToday, toDateColumn } from '../src/common/dates';
import type { NotificationQueue } from '../src/notifications/notification-queue';
import { NotificationService } from '../src/notifications/notification.service';
import { testCheckoutConfig } from '../src/payment/tests/checkout-config.fixture';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdminSourcingRequestService } from '../src/sourcing-request/admin-sourcing-request.service';
import { AgentSourcingRequestService } from '../src/sourcing-request/agent-sourcing-request.service';
import { SourcingConfig } from '../src/sourcing-request/sourcing-config';
import { SourcingResponseService } from '../src/sourcing-request/sourcing-response.service';

// Runs against the docker compose Postgres (test/e2e-guard.ts refuses any
// other). Mocks hide the CHECK constraints on AuditEvent, so these drive the
// services against real tables. Rows are tagged with this run's id and
// removed in afterAll.
const run = randomUUID().slice(0, 8);

describe('Agent-driven sourcing (real Postgres)', () => {
  const db = new PrismaService(new ConfigService());
  const queue = { enqueue: jest.fn() } as unknown as NotificationQueue;
  const config = new SourcingConfig(
    new ConfigService({
      SOURCING_RESPONSE_HOURS: '24',
      SOURCING_CHECKOUT_HOLD_HOURS: '48',
    }),
  );
  const notifications = new NotificationService(db, queue);
  const audit = new AuditService(db);
  const agentRequests = new AgentSourcingRequestService(
    db,
    config,
    notifications,
    audit,
    testCheckoutConfig(),
  );
  const sweep = new SourcingResponseService(db, config, notifications, audit);
  const adminRequests = new AdminSourcingRequestService(
    db,
    audit,
    notifications,
  );
  const requestIds: string[] = [];
  let users: User[];
  let admin: User;
  let buyer: Buyer;
  let agent: Agent;
  let farmer: Farmer;
  let state: State;
  let lga: Lga;
  const farmIds: string[] = [];

  function user(role: Role) {
    const tag = `${run}-${randomUUID()}`;
    return db.user.create({
      data: {
        firebaseUid: `e2e-${tag}`,
        email: `e2e-${tag}@example.com`,
        firstName: 'E2E',
        lastName: role,
        role,
        isVerified: true,
      },
    });
  }

  async function sourcingRequest(
    status: SourcingRequestStatus,
    assignedAt: Date | null = new Date(),
  ) {
    const request = await db.sourcingRequest.create({
      data: {
        buyerId: buyer.id,
        produceName: `E2E maize ${run}`,
        quantity: 10,
        unit: SourcingUnit.BAGS,
        quality: QualityGrade.GRADE_A,
        packaging: PackagingType.BAGS,
        condition: ProduceCondition.FRESH,
        deliveryDestination: 'Kano',
        requiredDate: toDateColumn(addDays(lagosToday(), 10)),
        status,
        assignedAgentId: assignedAt ? agent.id : null,
        assignedAt,
      },
    });
    requestIds.push(request.id);
    return request;
  }

  async function farm(
    name: string,
    mainProduce: string,
    verificationStatus: FarmVerificationStatus = FarmVerificationStatus.VERIFIED,
  ): Promise<Farm> {
    const created = await db.farm.create({
      data: {
        ownerId: farmer.id,
        name: `E2E ${name} ${run}`,
        stateId: state.id,
        lgaId: lga.id,
        location: '1 Test Road',
        size: 1,
        mainProduce,
        verificationStatus,
      },
    });
    farmIds.push(created.id);
    return created;
  }

  function listing(farmId: string, name: string, status: ProduceStatus) {
    return db.produce.create({
      data: {
        farmId,
        name,
        quantity: 0,
        actualQuantity: 0,
        floatingQuantity: 0,
        unit: 'kg',
        pricePerUnit: '1.00',
        status,
      },
    });
  }

  function auditRows(requestId: string) {
    return db.auditEvent.findMany({
      where: { sourcingRequestId: requestId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  beforeAll(async () => {
    await db.$connect();
    const [adminUser, buyerUser, agentUser, farmerUser] = [
      await user(Role.ADMIN),
      await user(Role.BUYER),
      await user(Role.EXTENSION_AGENT),
      await user(Role.FARMER),
    ];
    users = [adminUser, buyerUser, agentUser, farmerUser];
    farmer = await db.farmer.create({ data: { userId: farmerUser.id } });
    state = await db.state.create({ data: { name: `E2E State ${run}` } });
    lga = await db.lga.create({
      data: { stateId: state.id, name: `E2E LGA ${run}` },
    });
    admin = adminUser;
    buyer = await db.buyer.create({ data: { userId: buyerUser.id } });
    agent = await db.agent.create({
      data: { userId: agentUser.id, isVerified: true },
    });
  });

  afterAll(async () => {
    // Conversations and contracts restrict deletes; declines, offers and
    // audit rows cascade with their request.
    await db.conversation.deleteMany({
      where: { sourcingRequestId: { in: requestIds } },
    });
    await db.sourcingContract.deleteMany({
      where: { sourcingRequestId: { in: requestIds } },
    });
    await db.sourcingRequest.deleteMany({ where: { id: { in: requestIds } } });
    await db.produce.deleteMany({ where: { farmId: { in: farmIds } } });
    await db.farm.deleteMany({ where: { id: { in: farmIds } } });
    await db.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await db.lga.delete({ where: { id: lga.id } });
    await db.state.delete({ where: { id: state.id } });
    await db.$disconnect();
  });

  it('accepts: FINDING_SUPPLY, a buyer-agent conversation and an agent audit row', async () => {
    const request = await sourcingRequest(SourcingRequestStatus.ASSIGNED);

    await agentRequests.accept(agent, request.id);

    const after = await db.sourcingRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { conversation: true },
    });
    expect(after.status).toBe(SourcingRequestStatus.FINDING_SUPPLY);
    expect(after.conversation).toMatchObject({
      buyerId: buyer.id,
      agentUserId: agent.userId,
    });
    expect(await auditRows(request.id)).toEqual([
      expect.objectContaining({
        actorType: AuditActorType.EXTENSION_AGENT,
        actorUserId: agent.userId,
        agentId: agent.id,
        title: 'Request accepted',
      }),
    ]);
  });

  it('declines: back to PENDING with a SourcingDecline and an agent audit row', async () => {
    const request = await sourcingRequest(SourcingRequestStatus.ASSIGNED);

    await agentRequests.decline(agent, request.id, { reason: 'Too far' });

    const after = await db.sourcingRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { declines: true },
    });
    expect(after).toMatchObject({
      status: SourcingRequestStatus.PENDING,
      assignedAgentId: null,
      assignedAt: null,
    });
    expect(after.declines).toEqual([
      expect.objectContaining({ agentId: agent.id, reason: 'Too far' }),
    ]);
    expect(await auditRows(request.id)).toEqual([
      expect.objectContaining({
        actorType: AuditActorType.EXTENSION_AGENT,
        actorUserId: agent.userId,
        agentId: agent.id,
        title: 'Request declined',
        summary: 'Too far',
      }),
    ]);
    await expect(
      db.notification.count({
        where: { userId: buyer.userId, type: 'SOURCING_UNANSWERED' },
      }),
    ).resolves.toBeGreaterThanOrEqual(1);
  });

  it('the response sweep returns an unanswered request to the pool as SYSTEM', async () => {
    // Pinned far in the past with a matching `now`, so the sweep's cutoff
    // only reaches this request and never other rows in the local database.
    const assignedAt = new Date('2000-01-01T00:00:00.000Z');
    const now = new Date('2000-01-02T01:00:00.000Z');
    const request = await sourcingRequest(
      SourcingRequestStatus.ASSIGNED,
      assignedAt,
    );

    await expect(sweep.expireOverdue(now)).resolves.toBe(1);

    const after = await db.sourcingRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { declines: true },
    });
    expect(after).toMatchObject({
      status: SourcingRequestStatus.PENDING,
      assignedAgentId: null,
    });
    expect(after.declines).toEqual([
      expect.objectContaining({ agentId: agent.id, reason: null }),
    ]);
    expect(await auditRows(request.id)).toEqual([
      expect.objectContaining({
        actorType: AuditActorType.SYSTEM,
        actorUserId: null,
        agentId: null,
        title: 'Request returned to the pool',
      }),
    ]);
  });

  it('finds farms that grow or list the crop, never through a SOURCED listing, and offers them', async () => {
    const request = await sourcingRequest(SourcingRequestStatus.FINDING_SUPPLY);
    const crop = request.produceName;
    const grower = await farm('Grower', `${crop} and beans`);
    const lister = await farm('Lister', 'Cassava');
    await listing(lister.id, `Dried ${crop}`, ProduceStatus.DRAFT);
    const hiddenOnly = await farm('Hidden', 'Cassava');
    await listing(hiddenOnly.id, crop, ProduceStatus.SOURCED);
    await farm('Unverified', crop, FarmVerificationStatus.PENDING);

    const found = await agentRequests.farms(agent, request.id, {
      stateId: state.id,
    });
    expect(found.data.map((row) => row.farmId).sort()).toEqual(
      [grower.id, lister.id].sort(),
    );
    expect(found.data.every((row) => row.offerId === null)).toBe(true);
    // A DRAFT listing makes a match but is not one of the active names.
    expect(found.data.find((row) => row.farmId === lister.id)).toMatchObject({
      listingNames: [],
      farmName: lister.name,
    });

    const bySearch = await agentRequests.farms(agent, request.id, {
      search: `hidden ${run}`,
    });
    expect(bySearch.data.map((row) => row.farmId)).toEqual([hiddenOnly.id]);

    const detail = await agentRequests.setOffers(agent, request.id, {
      offers: [{ farmId: grower.id, quantity: 4, unit: SourcingUnit.BAGS }],
    });
    expect(detail.offers).toEqual([
      expect.objectContaining({
        farmId: grower.id,
        farmCode: grower.farmCode,
        quantity: 4,
        unit: SourcingUnit.BAGS,
        status: SourcingOfferStatus.OFFERED,
      }),
    ]);
    const again = await agentRequests.farms(agent, request.id, {
      stateId: state.id,
    });
    expect(again.data.find((row) => row.farmId === grower.id)?.offerId).toBe(
      detail.offers[0].id,
    );
    await expect(
      db.notification.count({
        where: { userId: farmer.userId, type: 'SOURCING_OFFER' },
      }),
    ).resolves.toBe(1);
  });

  it('admin closes an open request', async () => {
    const request = await sourcingRequest(SourcingRequestStatus.FINDING_SUPPLY);

    const detail = await adminRequests.close(admin, request.id, {
      reason: 'Buyer withdrew',
    });

    expect(detail.status).toBe(SourcingRequestStatus.CLOSED);
    const after = await db.sourcingRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.closedAt).not.toBeNull();
    expect(after.closeReason).toBe('Buyer withdrew');
    expect(await auditRows(request.id)).toEqual([
      expect.objectContaining({
        actorType: AuditActorType.ADMIN,
        actorUserId: admin.id,
        agentId: agent.id,
        title: 'Request closed',
      }),
    ]);
  });

  it('admin close of a CONFIRMED request voids its live contract', async () => {
    const request = await sourcingRequest(SourcingRequestStatus.CONFIRMED);
    await db.sourcingContract.create({
      data: {
        sourcingRequestId: request.id,
        agreedPrice: '12420.00',
        terms: { e2e: run },
      },
    });

    await adminRequests.close(admin, request.id, { reason: 'Price dispute' });

    const contract = await db.sourcingContract.findFirstOrThrow({
      where: { sourcingRequestId: request.id },
    });
    expect(contract.voidedAt).not.toBeNull();
  });
});
