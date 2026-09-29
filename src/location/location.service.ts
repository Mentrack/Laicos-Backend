import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';

/** Nigeria's states and LGAs, seeded by migration and never written here. */
@Injectable()
export class LocationService {
  constructor(private readonly database: PrismaService) {}

  findStates() {
    return this.database.state.findMany({ orderBy: { name: 'asc' } });
  }

  async findLgas(stateId: string) {
    const state = await this.database.state.findUnique({
      where: { id: stateId },
      include: { lgas: { orderBy: { name: 'asc' } } },
    });
    if (!state) {
      throw new NotFoundException('State not found');
    }
    return state.lgas;
  }

  /**
   * The LGA, provided it lies in `stateId`. Farm and agent writes call this
   * before storing the pair, because assignment matches on the LGA alone and
   * a mismatched state would go unnoticed.
   */
  async requireLga(
    stateId: string,
    lgaId: string,
    client: Prisma.TransactionClient = this.database,
  ) {
    const lga = await client.lga.findFirst({ where: { id: lgaId, stateId } });
    if (!lga) {
      throw new BadRequestException('Invalid state or LGA');
    }
    return lga;
  }
}
