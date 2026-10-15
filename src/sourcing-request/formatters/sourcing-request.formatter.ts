import type { SourcingRequest } from '../../../generated/client';
import { fromDateColumn } from '../../common/dates';
import type { SourcingRequestDto } from '../dto';

export function formatSourcingRequest(
  request: SourcingRequest,
  checkoutId: string | null = null,
): SourcingRequestDto {
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    produceName: request.produceName,
    quantity: request.quantity,
    unit: request.unit,
    quality: request.quality,
    packaging: request.packaging,
    condition: request.condition,
    additionalSpecs: request.additionalSpecs,
    deliveryDestination: request.deliveryDestination,
    requiredDate: fromDateColumn(request.requiredDate),
    timeline: request.timeline,
    logisticsNotes: request.logisticsNotes,
    status: request.status,
    checkoutId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
