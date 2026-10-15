import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Role } from '../../../generated/client';
import { ActivationGuard } from '../guards/activation.guard';
import { FarmerStandingGuard } from '../guards/farmer-standing.guard';
import { FirebaseAuthGuard } from '../guards/firebase-auth.guard';
import { OptionalAuthGuard } from '../guards/optional-auth.guard';
import { PasswordChangeGuard } from '../guards/password-change.guard';
import { RequireLocalUserGuard } from '../guards/require-local-user.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';

/** Any authenticated user when called with no roles. */
export const Auth = (...roles: Role[]) =>
  applyDecorators(
    ApiBearerAuth(),
    UseGuards(
      FirebaseAuthGuard,
      RequireLocalUserGuard,
      ActivationGuard,
      FarmerStandingGuard,
      PasswordChangeGuard,
      RolesGuard,
    ),
    Roles(roles),
  );

/** Guests allowed; a sent token is checked exactly as `@Auth()` would. */
export const OptionalAuth = () =>
  applyDecorators(ApiBearerAuth(), UseGuards(OptionalAuthGuard));
