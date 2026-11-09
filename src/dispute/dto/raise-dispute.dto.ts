import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { Trimmed } from '../../common/dto/trimmed';

export class RaiseDisputeDto {
  @ApiProperty({ example: 'Half the bags arrived wet', maxLength: 1000 })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 2,
    description: "Units affected, at most the order's quantity",
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantityAffected: number;
}
