import { OrderStatus, SourcingUnit } from '../../../generated/client';
import {
  coverage,
  deriveSourcingStatus,
  isListingEligible,
  requestedAmount,
  unitsComparable,
} from '../utils/sourcing-rules';

const open: Parameters<typeof deriveSourcingStatus>[0] = {
  closedAt: null,
  assignedAgentId: null,
  allocationCount: 0,
  awaitingPayment: false,
  paidOrders: null,
};

describe('sourcing rules', () => {
  it('rounds a tonne request half up to whole kilograms', () => {
    expect(requestedAmount(20, SourcingUnit.TONNES)).toBe(20000);
    expect(requestedAmount(0.0005, SourcingUnit.TONNES)).toBe(1);
    expect(requestedAmount(20.4, SourcingUnit.KG)).toBe(20);
  });

  it('keeps bags in the request unit and only matches that word', () => {
    expect(requestedAmount(10.5, SourcingUnit.BAGS)).toBe(10.5);
    expect(unitsComparable(SourcingUnit.BAGS, 'Bags')).toBe(true);
    expect(unitsComparable(SourcingUnit.TONNES, 'tonnes')).toBe(false);
    expect(unitsComparable(SourcingUnit.KG, ' kg ')).toBe(true);
  });

  it('reports a zero remaining when the selection covers or exceeds', () => {
    expect(coverage(20000, 17000)).toEqual({
      requested: 20000,
      selected: 17000,
      remaining: 3000,
    });
    expect(coverage(20000, 21000).remaining).toBe(0);
  });

  it('accepts a published verified listing in the agent cluster', () => {
    expect(
      isListingEligible({
        statusPublished: true,
        floatingQuantity: 8000,
        listingName: ' White Maize ',
        requestName: 'white maize',
        farmVerified: true,
        inAgentCluster: true,
        requestUnit: SourcingUnit.TONNES,
        listingUnit: 'kg',
      }),
    ).toBe(true);
  });

  it.each([
    ['flour is a different name', { listingName: 'White maize flour' }],
    ['draft', { statusPublished: false }],
    ['no stock', { floatingQuantity: 0 }],
    ['unverified farm', { farmVerified: false }],
    ['other cluster', { inAgentCluster: false }],
    ['crates against maize', { listingUnit: 'crate' }],
  ])('rejects %s', (_label, patch) => {
    expect(
      isListingEligible({
        statusPublished: true,
        floatingQuantity: 8000,
        listingName: 'White maize',
        requestName: 'White maize',
        farmVerified: true,
        inAgentCluster: true,
        requestUnit: SourcingUnit.KG,
        listingUnit: 'kg',
        ...patch,
      }),
    ).toBe(false);
  });

  it('walks the status ladder and ignores an empty paid list', () => {
    expect(deriveSourcingStatus(open)).toBe('NEW');
    expect(
      deriveSourcingStatus({ ...open, assignedAgentId: 'agent-1' }),
    ).toBe('IN_REVIEW');
    expect(
      deriveSourcingStatus({
        ...open,
        assignedAgentId: 'agent-1',
        allocationCount: 2,
      }),
    ).toBe('FINDING_SUPPLY');
    expect(deriveSourcingStatus({ ...open, awaitingPayment: true })).toBe(
      'AWAITING_BUYER',
    );
    expect(deriveSourcingStatus({ ...open, paidOrders: [] })).toBe('CONFIRMED');
    expect(
      deriveSourcingStatus({
        ...open,
        paidOrders: [OrderStatus.PENDING, OrderStatus.PREPARING],
      }),
    ).toBe('CONFIRMED');
    expect(
      deriveSourcingStatus({
        ...open,
        paidOrders: [OrderStatus.FULFILLED, OrderStatus.PREPARING],
      }),
    ).toBe('FULFILMENT');
    expect(
      deriveSourcingStatus({
        ...open,
        paidOrders: [OrderStatus.READY],
      }),
    ).toBe('FULFILMENT');
    expect(
      deriveSourcingStatus({
        ...open,
        paidOrders: [OrderStatus.FULFILLED, OrderStatus.CANCELLED],
      }),
    ).toBe('COMPLETED');
    expect(
      deriveSourcingStatus({
        ...open,
        paidOrders: [OrderStatus.CANCELLED],
      }),
    ).toBe('CLOSED');
    expect(
      deriveSourcingStatus({
        ...open,
        closedAt: new Date(),
        paidOrders: [OrderStatus.FULFILLED],
      }),
    ).toBe('CLOSED');
  });
});
