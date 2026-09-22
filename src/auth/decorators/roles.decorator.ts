import { Reflector } from '@nestjs/core';
import type { Role } from '../../../generated/client';

export const Roles = Reflector.createDecorator<Role[]>();
