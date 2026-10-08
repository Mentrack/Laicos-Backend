import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '../../generated/client';
import {
  PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSourcingRequestDto } from './dto';
import { formatSourcingRequest } from './formatters/sourcing-request.formatter';

// en-CA formats as YYYY-MM-DD, so dates compare as plain strings.
const lagosDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
});

@Injectable()
export class SourcingRequestService {
  constructor(private readonly database: PrismaService) {}

  async create(user: User, dto: CreateSourcingRequestDto) {
    if (dto.requiredDate < lagosDate.format(new Date())) {
      throw new BadRequestException('Required date cannot be in the past');
    }
    const request = await this.database.sourcingRequest.create({
      data: {
        ...dto,
        requiredDate: new Date(`${dto.requiredDate}T00:00:00.000Z`),
        buyerId: user.id,
      },
    });
    return formatSourcingRequest(request);
  }

  async findAll(user: User, query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = { buyerId: user.id };
    const [requests, total] = await this.database.$transaction([
      this.database.sourcingRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.sourcingRequest.count({ where }),
    ]);
    return {
      data: requests.map(formatSourcingRequest),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async findOne(user: User, id: string) {
    const request = await this.database.sourcingRequest.findFirst({
      where: { id, buyerId: user.id },
    });
    if (!request) {
      throw new NotFoundException('Sourcing request not found');
    }
    return formatSourcingRequest(request);
  }
}
