import {
  BuyerType,
  CheckoutStatus,
  OrderStatus,
  PaymentProvider,
  ProduceType,
} from '../../../generated/client';
import {
  toAdminOrderDetail,
  type AdminDetailedOrder,
} from '../formatters/admin-order-detail.formatter';

const decimal = (value: string) => ({ toFixed: () => value });

const buyer = {
  id: 'b-1',
  buyerId: 'BY-000001',
  buyerType: BuyerType.COMPANY,
  legalName: 'Acme Ltd',
  contactPhone: '0800',
  user: { firstName: 'Ada', lastName: 'Obi', phoneNumber: '0900' },
};

const farm = {
  id: 'f-1',
  farmCode: 'LF-000001',
  name: 'Green Acres',
  verificationStatus: 'VERIFIED',
  lga: { name: 'Ikeja' },
  state: { name: 'Lagos' },
  cluster: { clusterCode: 'CL-000001' },
  verifications: [{ decidedAt: new Date('2026-09-01T00:00:00.000Z') }],
};

const checkout = {
  checkoutNumber: 'CHK-000001',
  status: CheckoutStatus.PAID,
  totalPrice: decimal('1100.00'),
  expiresAt: new Date('2026-10-09T11:00:00.000Z'),
  paidAt: new Date('2026-10-09T10:30:00.000Z'),
  createdAt: new Date('2026-10-09T09:00:00.000Z'),
  deliveryLabel: 'Warehouse',
  deliveryStreet: '4 Marina Road',
  deliveryLga: 'Lagos Island',
  deliveryState: 'Lagos',
  payments: [
    {
      reference: 'PAY-000001',
      provider: PaymentProvider.PAYSTACK,
      channel: 'card',
      amount: decimal('1100.00'),
      currency: 'NGN',
    },
  ],
  sourcingRequest: {
    id: 'sr-1',
    requestNumber: 'REQ-000001',
    produceName: 'Maize',
    quantity: 500,
    unit: 'KG',
    allocations: [
      { produce: { farmId: 'f-1' } },
      { produce: { farmId: 'f-1' } },
      { produce: { farmId: 'f-2' } },
    ],
  },
};

function order(overrides: object = {}) {
  return {
    id: 'o-1',
    orderNumber: 'ORD-000001',
    createdAt: new Date('2026-10-09T10:00:00.000Z'),
    status: OrderStatus.PENDING,
    quantity: 5,
    type: ProduceType.LOCAL,
    produceName: 'Maize',
    totalPrice: decimal('1000.00'),
    agentCommission: decimal('50.00'),
    cancellationReason: null,
    fulfilledAt: null,
    produce: { unit: 'kg' },
    buyer,
    farm,
    checkout,
    dispute: null,
    ...overrides,
  } as unknown as AdminDetailedOrder;
}

describe('toAdminOrderDetail', () => {
  it('gives a legacy order without a checkout no payment, request or destination', () => {
    const detail = toAdminOrderDetail(order({ checkout: null }));
    expect(detail.payment).toBeNull();
    expect(detail.sourcingRequest).toBeNull();
    expect(detail.buyer.deliveryDestination).toBeNull();
  });

  it('names a COMPANY buyer by legalName and prefers its contactPhone', () => {
    const detail = toAdminOrderDetail(order());
    expect(detail.buyer.name).toBe('Acme Ltd');
    expect(detail.buyer.contactPhone).toBe('0800');
  });

  it('falls back to the user phone', () => {
    const detail = toAdminOrderDetail(
      order({ buyer: { ...buyer, contactPhone: null } }),
    );
    expect(detail.buyer.contactPhone).toBe('0900');
  });

  it('joins the delivery snapshot', () => {
    expect(toAdminOrderDetail(order()).buyer.deliveryDestination).toBe(
      'Warehouse, 4 Marina Road, Lagos Island, Lagos',
    );
  });

  it('gives a null destination when every delivery part is empty', () => {
    const empty = {
      ...checkout,
      deliveryLabel: null,
      deliveryStreet: '',
      deliveryLga: null,
      deliveryState: null,
    };
    expect(
      toAdminOrderDetail(order({ checkout: empty })).buyer.deliveryDestination,
    ).toBeNull();
  });

  it('maps the succeeded payment, the request and distinct farms', () => {
    const detail = toAdminOrderDetail(order());
    expect(detail.payment?.payment?.reference).toBe('PAY-000001');
    expect(detail.payment?.total).toBe('1100.00');
    expect(detail.sourcingRequest).toMatchObject({
      farmsAllocated: 2,
      quantity: 500,
      unit: 'KG',
      confirmedAt: new Date('2026-10-09T09:00:00.000Z'),
    });
  });

  it('has a null attempt when no payment succeeded', () => {
    const detail = toAdminOrderDetail(
      order({ checkout: { ...checkout, payments: [] } }),
    );
    expect(detail.payment?.payment).toBeNull();
  });

  it('maps a dispute with refundPercent as a string', () => {
    const detail = toAdminOrderDetail(
      order({
        dispute: {
          id: 'd-1',
          status: 'RESOLVED',
          reason: 'Spoiled',
          quantityAffected: 2,
          raisedBy: { firstName: 'Ada', lastName: 'Obi' },
          createdAt: new Date('2026-10-10T00:00:00.000Z'),
          refundPercent: decimal('50.00'),
          resolutionNote: 'Refunded half',
          resolvedAt: new Date('2026-10-11T00:00:00.000Z'),
        },
      }),
    );
    expect(detail.dispute).toMatchObject({
      refundPercent: '50.00',
      raisedBy: 'Ada Obi',
    });
  });

  it('gives an unclustered farm a null clusterCode, and no verifiedAt without a round', () => {
    const detail = toAdminOrderDetail(
      order({ farm: { ...farm, cluster: null, verifications: [] } }),
    );
    expect(detail.farm.clusterCode).toBeNull();
    expect(detail.farm.verifiedAt).toBeNull();
  });
});
