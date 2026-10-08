import { Injectable, NotFoundException } from '@nestjs/common';
import { FarmVerificationStatus, type User } from '../../../generated/client';
import { farmOwnedBy } from '../../common/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FARM_PROFILE_SELECT,
  formatFarmProfile,
} from '../formatters/farm-profile.formatter';

/** The public face of a farm, under the same visibility rule as its produce. */
@Injectable()
export class FarmProfileService {
  constructor(private readonly database: PrismaService) {}

  async findOne(user: User, id: string) {
    const farm = await this.database.farm.findFirst({
      where: {
        id,
        OR: [
          { verificationStatus: FarmVerificationStatus.VERIFIED },
          farmOwnedBy(user),
        ],
      },
      select: FARM_PROFILE_SELECT,
    });
    if (!farm) {
      throw new NotFoundException('Farm not found');
    }
    return formatFarmProfile(farm);
  }
}
