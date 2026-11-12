import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Role } from '../../../generated/client';
import { ActivationGuard } from '../guards/activation.guard';
import { AccountStandingGuard } from '../guards/account-standing.guard';
import { FirebaseAuthGuard } from '../guards/firebase-auth.guard';
import { OptionalAuthGuard } from '../guards/optional-auth.guard';
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
      AccountStandingGuard,
      RolesGuard,
    ),
    Roles(roles),
  );

/** Guests allowed; a sent token is checked exactly as `@Auth()` would. */
export const OptionalAuth = () =>
  applyDecorators(ApiBearerAuth(), UseGuards(OptionalAuthGuard));
