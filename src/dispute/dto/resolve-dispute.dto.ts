import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trimmed } from '../../common/dto/trimmed';

export class ResolveDisputeDto {
  @ApiProperty({
    minimum: 0,
    maximum: 100,
    example: 30,
    description:
      'Percent of what the buyer paid for the order to refund, up to 2 dp. 0 means solved without a refund; the farmer and agent are paid the rest.',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  refundPercent: number;

  @ApiProperty({ example: 'Two bags were spoiled; refunding their share' })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}
