import { Prisma, type FarmerBankAccount } from '../../../generated/client';
import type { EligiblePayoutDto, PayoutDto } from '../dto';
import { maskAccount } from '../utils/mask-account';

export const PAYOUT_INCLUDE = { items: true } satisfies Prisma.PayoutInclude;

export type PayoutRow = Prisma.PayoutGetPayload<{
  include: typeof PAYOUT_INCLUDE;
}>;

export function formatPayout(payout: PayoutRow): PayoutDto {
  return {
    id: payout.id,
    reference: payout.reference,
    farmerId: payout.farmerId,
    amount: payout.amount.toFixed(2),
    status: payout.status,
    bankName: payout.bankName,
    accountNumber: maskAccount(payout.accountNumber),
    accountName: payout.accountName,
    failureReason: payout.failureReason,
    paidAt: payout.paidAt,
    createdAt: payout.createdAt,
    items: payout.items.map((item) => ({
      orderId: item.orderId,
      amount: item.amount.toFixed(2),
    })),
  };
}

type EligibleFarmer = {
  id: string;
  farmerId: string;
  user: { firstName: string; lastName: string };
  farms: {
    orders: {
      id: string;
      orderNumber: string;
      totalPrice: Prisma.Decimal;
      fulfilledAt: Date | null;
    }[];
  }[];
};

export function formatEligible(
  farmer: EligibleFarmer,
  account: FarmerBankAccount,
): EligiblePayoutDto {
  const orders = farmer.farms.flatMap((farm) => farm.orders);
  return {
    farmerId: farmer.id,
    farmerCode: farmer.farmerId,
    firstName: farmer.user.firstName,
    lastName: farmer.user.lastName,
    bankName: account.bankName,
    accountNumber: maskAccount(account.accountNumber),
    accountName: account.accountName,
    total: orders
      .reduce((sum, order) => sum.add(order.totalPrice), new Prisma.Decimal(0))
      .toFixed(2),
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      amount: order.totalPrice.toFixed(2),
      // Eligibility filters on fulfilledAt, so it is set on every row here.
      fulfilledAt: order.fulfilledAt ?? new Date(0),
    })),
  };
}
