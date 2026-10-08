import { BadRequestException } from '@nestjs/common';
import type { Agent } from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import { FarmerRegistrationService } from '../../farm/services/farmer-registration.service';
import { FarmerOnboardingService } from '../farmer-onboarding.service';

const agent = {
  id: 'agent-1',
  stateId: 'state-1',
  lgaId: 'lga-1',
  isVerified: true,
} as Agent;
const dto = {
  firstName: 'Ada',
  lastName: 'Okafor',
  phoneNumber: '+2348012345678',
  email: 'ada@example.com',
  farm: {
    name: 'Green Acres',
    location: '12 Market Road',
    size: 2.5,
    mainProduce: 'Maize',
  },
};

describe('FarmerOnboardingService', () => {
  const auth = { createFirebaseUser: jest.fn() };
  const registration = { register: jest.fn() };
  const service = new FarmerOnboardingService(
    auth as unknown as AuthService,
    registration as unknown as FarmerRegistrationService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    auth.createFirebaseUser.mockResolvedValue({ uid: 'uid-1' });
    registration.register.mockResolvedValue({ farm: { id: 'farm-1' } });
  });

  it('registers the farmer without a password, in the agent’s LGA and round', async () => {
    await expect(service.onboard(agent, dto)).resolves.toEqual({
      farm: { id: 'farm-1' },
    });
    expect(auth.createFirebaseUser).toHaveBeenCalledWith({
      email: dto.email,
      firstName: 'Ada',
      lastName: 'Okafor',
    });
    expect(registration.register).toHaveBeenCalledWith({
      account: { uid: 'uid-1', isNew: true },
      user: {
        email: dto.email,
        firstName: 'Ada',
        lastName: 'Okafor',
        phoneNumber: dto.phoneNumber,
        isVerified: false,
      },
      farm: {
        ...dto.farm,
        stateId: 'state-1',
        lgaId: 'lga-1',
        referralAgentId: 'agent-1',
      },
      documents: {},
      preferredAgentId: 'agent-1',
    });
  });

  it('refuses an agent without a location before creating anything', async () => {
    await expect(
      service.onboard({ ...agent, lgaId: null }, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.createFirebaseUser).not.toHaveBeenCalled();
  });
});
