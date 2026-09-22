import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Role } from '../../../generated/client';
import { FirebaseAuthGuard } from '../guards/firebase-auth.guard';
import { RequireLocalUserGuard } from '../guards/require-local-user.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';

/** Any authenticated user when called with no roles. */
export const Auth = (...roles: Role[]) =>
  applyDecorators(
    ApiBearerAuth(),
    UseGuards(FirebaseAuthGuard, RequireLocalUserGuard, RolesGuard),
    Roles(roles),
  );
