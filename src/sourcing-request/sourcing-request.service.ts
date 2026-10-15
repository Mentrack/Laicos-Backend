import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  CheckoutStatus,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { requireBuyer } from '../buyer/utils/require-buyer';
import { lagosToday, toDateColumn } from '../common/dates';
import {
  PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSourcingRequestDto } from './dto';
import { formatSourcingRequest } from './formatters/sourcing-request.formatter';

@Injectable()
export class SourcingRequestService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(user: User, dto: CreateSourcingRequestDto) {
    if (dto.requiredDate < lagosToday()) {
      throw new BadRequestException('Required date cannot be in the past');
    }
    const buyer = await requireBuyer(this.database, user);
    const request = await this.database.$transaction(async (tx) => {
      const created = await tx.sourcingRequest.create({
        data: {
          ...dto,
          requiredDate: toDateColumn(dto.requiredDate),
          buyerId: buyer.id,
        },
      });
      await this.audit.record(tx, {
        actorType: AuditActorType.BUYER,
        farmerId: null,
        agentId: null,
        farmId: null,
        category: AuditCategory.SOURCING,
        title: 'Request submitted',
        summary: `${created.requestNumber}: ${created.quantity} ${created.unit} ${created.produceName}`,
        actionLabel: 'View request',
        resource: AuditResource.SOURCING_REQUEST,
        resourceId: created.id,
        sourcingRequestId: created.id,
      });
      return created;
    });
    return formatSourcingRequest(request);
  }

  async findAll(user: User, query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const buyer = await requireBuyer(this.database, user);
    const where = { buyerId: buyer.id };
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
      data: requests.map((request) => formatSourcingRequest(request)),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async findOne(user: User, id: string) {
    const buyer = await requireBuyer(this.database, user);
    const request = await this.database.sourcingRequest.findFirst({
      where: { id, buyerId: buyer.id },
      include: {
        checkouts: {
          where: { status: CheckoutStatus.AWAITING_PAYMENT },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!request) {
      throw new NotFoundException('Sourcing request not found');
    }
    return formatSourcingRequest(request, request.checkouts[0]?.id ?? null);
  }
}
