import { OmitType } from '@nestjs/swagger';
import type { Prisma, Role } from '../../../generated/client';
import { RegisterDto } from './register.dto';

/**
 * Service-internal input for the local `User` row, shared by password and
 * Google registration, farmer and agent signup, and admin invites. Not a
 * request body, so it carries no validators.
 */
export class CreateLocalUserDto extends OmitType(RegisterDto, [
  'password',
  'role',
] as const) {
  // RegisterDto refuses these, but their own signups create them here.
  role:
    | RegisterDto['role']
    | typeof Role.FARMER
    | typeof Role.EXTENSION_AGENT
    | typeof Role.ADMIN;
  firebaseUid: string;
  isVerified: boolean;
  agreedToTerms?: boolean;
  /** The FARMER user's profile, created in the same write. */
  farmer?: Prisma.FarmerCreateWithoutUserInput;
  /** The EXTENSION_AGENT user's profile; gets an empty cluster if none given. */
  agent?: Prisma.AgentCreateWithoutUserInput;
  /** The BUYER user's profile, created in the same write. */
  buyer?: Prisma.BuyerCreateWithoutUserInput;
  /** The ADMIN user's profile, created in the same write. */
  admin?: Prisma.AdminCreateWithoutUserInput;
  /** Set on an invited admin's temporary password. */
  mustChangePassword?: boolean;
  /** Stored in the same write, so no half-created user needs undoing. */
  refreshToken?: string;
}
