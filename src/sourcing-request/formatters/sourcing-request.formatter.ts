import type { SourcingRequest } from '../../../generated/client';
import { fromDateColumn } from '../../common/dates';
import type { SourcingRequestDto } from '../dto';

export function formatSourcingRequest(
  request: SourcingRequest,
): SourcingRequestDto {
  const { buyerId: _buyerId, ...rest } = request;
  return {
    ...rest,
    requiredDate: fromDateColumn(request.requiredDate),
  };
}
