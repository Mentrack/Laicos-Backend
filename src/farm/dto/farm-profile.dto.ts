import { ApiProperty } from '@nestjs/swagger';
import { FarmVerificationStatus } from '../../../generated/client';
import { LgaDto, StateDto } from '../../location/dto';

/** What any signed-in user sees of a farm: no address, no owner. */
export class FarmProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LF-000123' })
  farmCode: string;

  @ApiProperty({
    enum: FarmVerificationStatus,
    enumName: 'FarmVerificationStatus',
  })
  verificationStatus: FarmVerificationStatus;

  @ApiProperty({ example: 'NG' })
  country: string;

  @ApiProperty({ type: StateDto })
  state: StateDto;

  @ApiProperty({ type: LgaDto })
  lga: LgaDto;

  @ApiProperty({
    type: [String],
    example: ['Cassava', 'Groundnut', 'Sesame Seeds', 'Yam'],
    description:
      'The declared main produce, then the names of its listings, deduplicated',
  })
  primaryProduce: string[];
}
