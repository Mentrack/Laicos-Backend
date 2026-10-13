import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsUUID,
} from 'class-validator';

export class ApprovePayoutsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Farmer.id values from GET /admin/payouts/eligible (1-100)',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  farmerIds: string[];
}
