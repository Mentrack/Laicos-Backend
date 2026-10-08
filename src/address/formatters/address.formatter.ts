import type { Prisma } from '../../../generated/client';
import type { AddressDto } from '../dto';

export const ADDRESS_INCLUDE = {
  state: { select: { id: true, name: true } },
  lga: { select: { id: true, name: true } },
} satisfies Prisma.AddressInclude;

export type AddressRow = Prisma.AddressGetPayload<{
  include: typeof ADDRESS_INCLUDE;
}>;

export function formatAddress(address: AddressRow): AddressDto {
  return {
    id: address.id,
    label: address.label,
    street: address.street,
    state: address.state,
    lga: address.lga,
    contactName: address.contactName,
    contactPhone: address.contactPhone,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
  };
}
