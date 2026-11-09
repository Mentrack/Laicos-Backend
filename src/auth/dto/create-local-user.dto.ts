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
  role: RegisterDto['role'] | typeof Role.ADMIN;
  firebaseUid: string;
  isVerified: boolean;
  agreedToTerms?: boolean;
  /** Passed by agent onboarding. Signup leaves this out; the application creates it. */
  farmer?: Prisma.FarmerCreateWithoutUserInput;
  /** Passed only when the agent row is created in the same write. */
  agent?: Prisma.AgentCreateWithoutUserInput;
  /** The BUYER user's profile, created in the same write. */
  buyer?: Prisma.BuyerCreateWithoutUserInput;
  /** The ADMIN user's profile, created in the same write. */
  admin?: Prisma.AdminCreateWithoutUserInput;
  /** Stored in the same write, so no half-created user needs undoing. */
  refreshToken?: string;
}
