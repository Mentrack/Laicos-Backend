import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid', description: 'A PUBLISHED produce' })
  @IsUUID()
  produceId: string;

  @ApiProperty({ example: 50, description: "In the produce's `unit`" })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  quantity: number;
}
