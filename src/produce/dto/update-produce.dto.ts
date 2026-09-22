import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProduceDto } from './create-produce.dto';

// A produce can't move farms: existing orders pin it via (produceId, farmId).
export class UpdateProduceDto extends PartialType(
  OmitType(CreateProduceDto, ['farmId'] as const),
) {}
