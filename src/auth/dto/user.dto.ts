import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../../generated/client';

export class UserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  firebaseUid: string;

  @ApiProperty({ example: 'Ada' })
  firstName: string;

  @ApiProperty({ example: 'Okafor' })
  lastName: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;

  @ApiProperty({ example: '+2348012345678' })
  phoneNumber: string;

  @ApiProperty({ enum: Role, enumName: 'Role', example: Role.FARMER })
  role: Role;

  @ApiProperty()
  agreedToTerms: boolean;

  @ApiProperty({ description: "Mirrors Firebase's emailVerified" })
  isVerified: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
