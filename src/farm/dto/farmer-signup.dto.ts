import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../auth/dto';
import { FarmDto } from './farm.dto';
import { FarmerDto } from './farmer.dto';

export class RegisteredFarmerDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ type: FarmerDto })
  farmer: FarmerDto;

  @ApiProperty({ type: FarmDto })
  farm: FarmDto;

  @ApiProperty({
    format: 'uuid',
    description: 'Open verification round; agents upload documents to it',
  })
  verificationId: string;
}
