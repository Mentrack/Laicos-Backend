import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, User } from '../../generated/client';
import { formatIdentity, replaceIdDocument } from '../common/identity';
import {
  PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../common/pagination';
import type { StorageUploadFile } from '../common/upload-pipes';
import { FARM_INCLUDE, formatFarm } from '../farm/formatters/farm.formatter';
import { LocationService } from '../location/location.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AgentProfileDto, UpdateAgentDto } from './dto';

const AGENT_INCLUDE = {
  state: true,
  lga: true,
  cluster: { include: { _count: { select: { farms: true } } } },
} satisfies Prisma.AgentInclude;

// Agent rows (and their clusters) are created with their EXTENSION_AGENT user
// in AuthService.createLocalUser and deleted with it, so there is no create
// or delete here. isVerified is an admin's to set, never the agent's.
@Injectable()
export class AgentService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly locations: LocationService,
  ) {}

  async findMine(user: User): Promise<AgentProfileDto> {
    const agent = await this.database.agent.findUnique({
      where: { userId: user.id },
      include: AGENT_INCLUDE,
    });
    if (!agent?.cluster) {
      throw new NotFoundException('Agent profile not found');
    }
    return {
      id: agent.id,
      agentId: agent.agentId,
      country: agent.country,
      state: agent.state && { id: agent.state.id, name: agent.state.name },
      lga: agent.lga && {
        id: agent.lga.id,
        stateId: agent.lga.stateId,
        name: agent.lga.name,
      },
      ...(await formatIdentity(this.storage, agent)),
      isVerified: agent.isVerified,
      verifiedAt: agent.verifiedAt,
      cluster: {
        id: agent.cluster.id,
        name: agent.cluster.name,
        farmCount: agent.cluster._count.farms,
      },
    };
  }

  async updateMine(user: User, dto: UpdateAgentDto) {
    const agent = await this.requireAgent(user);
    let location: Prisma.AgentUpdateInput = {};
    if (dto.stateId !== undefined || dto.lgaId !== undefined) {
      const stateId = dto.stateId ?? agent.stateId;
      const lgaId = dto.lgaId ?? agent.lgaId;
      if (!stateId || !lgaId) {
        throw new BadRequestException('Invalid state or LGA');
      }
      // The cluster is anchored to the LGA; moving a verified agent would
      // strand every farm already in it.
      if (agent.isVerified && lgaId !== agent.lgaId) {
        throw new ConflictException('LGA cannot change after verification');
      }
      const lga = await this.locations.requireLga(stateId, lgaId);
      location = {
        state: { connect: { id: stateId } },
        lga: { connect: { id: lgaId } },
        cluster: { update: { name: `${lga.name} Hub` } },
      };
    }
    await this.database.agent.update({
      where: { id: agent.id },
      data: { idType: dto.idType, idNumber: dto.idNumber, ...location },
    });
    return this.findMine(user);
  }

  async uploadIdDocument(user: User, file: StorageUploadFile) {
    const agent = await this.requireAgent(user);
    await replaceIdDocument(
      this.storage,
      `agents/${agent.id}/id`,
      file,
      agent.idDocumentKey,
      (idDocumentKey) =>
        this.database.agent.update({
          where: { id: agent.id },
          data: { idDocumentKey },
        }),
    );
    return this.findMine(user);
  }

  async findClusterFarms(user: User, query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.FarmWhereInput = {
      cluster: { agent: { userId: user.id } },
    };
    const [farms, total] = await this.database.$transaction([
      this.database.farm.findMany({
        where,
        include: FARM_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.farm.count({ where }),
    ]);
    return {
      data: await Promise.all(
        farms.map((farm) => formatFarm(this.storage, farm)),
      ),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  private async requireAgent(user: User) {
    const agent = await this.database.agent.findUnique({
      where: { userId: user.id },
    });
    if (!agent) {
      throw new NotFoundException('Agent profile not found');
    }
    return agent;
  }
}
