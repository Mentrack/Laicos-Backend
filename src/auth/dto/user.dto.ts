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

  @ApiProperty({ example: '+2348012345678', nullable: true, type: String })
  phoneNumber: string | null;

  @ApiProperty({ enum: Role, enumName: 'Role', example: Role.FARMER })
  role: Role;

  @ApiProperty()
  agreedToTerms: boolean;

  @ApiProperty({ description: "Mirrors Firebase's emailVerified" })
  isVerified: boolean;

  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'Farmers only: when their first farm was verified. Until then every authenticated route and sign-in answers 403 VERIFICATION_PENDING. Null for other roles.',
  })
  activatedAt: Date | null;

  @ApiProperty({
    description:
      'On the temporary password from a farmer’s invite. Every route but GET /auth/me, PATCH /auth/change-password and POST /auth/logout answers 403 PASSWORD_CHANGE_REQUIRED until it is changed.',
  })
  mustChangePassword: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
