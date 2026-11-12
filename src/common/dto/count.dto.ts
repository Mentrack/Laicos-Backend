import { ApiProperty } from '@nestjs/swagger';

export class CountDto {
  @ApiProperty({ example: 12 })
  total: number;
}
