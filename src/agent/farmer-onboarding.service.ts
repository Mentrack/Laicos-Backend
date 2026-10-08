import { BadRequestException, Injectable } from '@nestjs/common';
import type { Agent } from '../../generated/client';
import { AuthService } from '../auth/auth.service';
import type { RegisteredFarmerDto } from '../farm/dto';
import { FarmerRegistrationService } from '../farm/services/farmer-registration.service';
import type { OnboardFarmerDto } from './dto';

/**
 * An agent registers a farmer and their first farm in the field. The farm
 * takes the agent's location, names them as referral, and its round is
 * assigned to them. Like self-signup, the farmer has no password until the
 * farm is verified; documents can follow through the round.
 */
@Injectable()
export class FarmerOnboardingService {
  constructor(
    private readonly auth: AuthService,
    private readonly registration: FarmerRegistrationService,
  ) {}

  async onboard(
    agent: Agent,
    dto: OnboardFarmerDto,
  ): Promise<RegisteredFarmerDto> {
    const { stateId, lgaId } = agent;
    // Nullable columns; a verified agent has always set them.
    if (!stateId || !lgaId) {
      throw new BadRequestException('Set your state and LGA first');
    }
    const account = await this.auth.createFirebaseUser({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    return this.registration.register({
      account: { uid: account.uid, isNew: true },
      user: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        isVerified: false,
      },
      farm: { ...dto.farm, stateId, lgaId, referralAgentId: agent.id },
      documents: {},
      preferredAgentId: agent.id,
    });
  }
}
