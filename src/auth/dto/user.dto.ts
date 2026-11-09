import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationStatus, Role } from '../../../generated/client';

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

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Public URL of the profile photo; null until one is uploaded',
  })
  avatarUrl: string | null;

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
      'When a farmer’s first farm was verified, or an agent was verified. Null until then. A self-signup user can still sign in and open their application.',
  })
  activatedAt: Date | null;

  @ApiPropertyOptional({
    enum: ApplicationStatus,
    enumName: 'ApplicationStatus',
    nullable: true,
    description:
      'Self-signup farmers and agents. Null for everyone else, including a farmer an agent onboarded.',
  })
  applicationStatus?: ApplicationStatus | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
