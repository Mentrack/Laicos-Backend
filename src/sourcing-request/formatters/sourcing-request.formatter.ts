import type { SourcingRequest } from '../../../generated/client';
import type { SourcingRequestDto } from '../dto';

export function formatSourcingRequest(
  request: SourcingRequest,
): SourcingRequestDto {
  const { buyerId: _buyerId, ...rest } = request;
  // A @db.Date column comes back as UTC midnight; the calendar date is its ISO prefix.
  return {
    ...rest,
    requiredDate: request.requiredDate.toISOString().slice(0, 10),
  };
}
