import { OmitType } from '@nestjs/swagger';
import type { Prisma, Role } from '../../../generated/client';
import { RegisterDto } from './register.dto';

/**
 * Service-internal input for the local `User` row, shared by password and
 * Google registration and farmer and agent signup. Not a request body, so it carries
 * no validators.
 */
export class CreateLocalUserDto extends OmitType(RegisterDto, [
  'password',
  'role',
] as const) {
  // RegisterDto refuses these two, but their own signups create them here.
  role: RegisterDto['role'] | typeof Role.FARMER | typeof Role.EXTENSION_AGENT;
  firebaseUid: string;
  isVerified: boolean;
  agreedToTerms?: boolean;
  /** The FARMER user's profile, created in the same write. */
  farmer?: Prisma.FarmerCreateWithoutUserInput;
  /** The EXTENSION_AGENT user's profile; gets an empty cluster if none given. */
  agent?: Prisma.AgentCreateWithoutUserInput;
  /** Stored in the same write, so no half-created user needs undoing. */
  refreshToken?: string;
}
