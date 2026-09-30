import { ApiProperty } from '@nestjs/swagger';
import { LgaDto, StateDto } from '../../location/dto';

/** What an agent's task shows of its farm. */
export class FarmSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LF-000123' })
  farmCode: string;

  @ApiProperty({ example: 'Green Acres' })
  name: string;

  @ApiProperty({ example: '12 Market Road', description: 'Street address' })
  location: string;

  @ApiProperty({ type: StateDto })
  state: StateDto;

  @ApiProperty({ type: LgaDto })
  lga: LgaDto;

  @ApiProperty({ example: 5, description: 'Declared size, in `unit`' })
  size: number;

  @ApiProperty({ example: 'ha' })
  unit: string;

  @ApiProperty({ example: 'Maize' })
  mainProduce: string;
}
