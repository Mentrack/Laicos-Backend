import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BuyerType,
  Role,
  type Buyer,
  type Prisma,
  type User,
} from '../../generated/client';
import {
  COMPANY_FIELDS,
  assertBuyerKind,
  type CompanyField,
} from './utils/buyer-kind';
import { LocationService } from '../location/location.service';
import { PrismaService } from '../prisma/prisma.service';
import type { BuyerDto, BuyerProfileDto, UpdateBuyerDto } from './dto';
import { toBuyerDto, toBuyerProfileDto } from './formatters/buyer.formatter';
import { requireBuyer } from './utils/require-buyer';

const WITH_LOCATION = { state: true, lga: true } as const;

@Injectable()
export class BuyerService {
  constructor(
    private readonly database: PrismaService,
    private readonly locations: LocationService,
  ) {}

  async findMine(user: User): Promise<BuyerProfileDto> {
    const buyer = await this.database.buyer.findUnique({
      where: { userId: user.id },
      include: WITH_LOCATION,
    });
    if (!buyer) {
      throw new NotFoundException('Buyer profile not found');
    }
    return toBuyerProfileDto(buyer);
  }

  async updateMine(user: User, dto: UpdateBuyerDto) {
    const buyer = await requireBuyer(this.database, user);
    let location: Prisma.BuyerUpdateInput = {};
    if (dto.stateId !== undefined || dto.lgaId !== undefined) {
      const stateId = dto.stateId ?? buyer.stateId;
      const lgaId = dto.lgaId ?? buyer.lgaId;
      if (!stateId || !lgaId) {
        throw new BadRequestException('Invalid state or LGA');
      }
      await this.locations.requireLga(stateId, lgaId);
      location = {
        state: { connect: { id: stateId } },
        lga: { connect: { id: lgaId } },
      };
    }
    const kind =
      dto.buyerType !== undefined ||
      COMPANY_FIELDS.some((field) => dto[field] !== undefined)
        ? nextBuyerKind(buyer, dto)
        : {};
    await this.database.buyer.update({
      where: { id: buyer.id },
      data: { ...location, ...kind },
    });
    return this.findMine(user);
  }

  async findOne(id: string): Promise<BuyerDto> {
    const buyer = await this.database.buyer.findUnique({ where: { id } });
    if (!buyer) {
      throw new NotFoundException('Buyer profile not found');
    }
    return toBuyerDto(buyer);
  }
}

function nextBuyerKind(
  buyer: Pick<Buyer, 'buyerType' | CompanyField>,
  dto: UpdateBuyerDto,
): Prisma.BuyerUpdateInput {
  const buyerType = dto.buyerType ?? buyer.buyerType;
  if (buyerType === BuyerType.PERSON) {
    assertBuyerKind(Role.BUYER, { buyerType, ...dto });
    return {
      buyerType,
      legalName: null,
      department: null,
      contactName: null,
      contactPhone: null,
      paymentTerms: null,
    };
  }
  const fields = Object.fromEntries(
    COMPANY_FIELDS.map((field) => [field, dto[field] ?? buyer[field] ?? '']),
  ) as Record<CompanyField, string>;
  assertBuyerKind(Role.BUYER, { buyerType, ...fields });
  return {
    buyerType,
    legalName: fields.legalName.trim(),
    department: fields.department.trim(),
    contactName: fields.contactName.trim(),
    contactPhone: fields.contactPhone.trim(),
    paymentTerms: fields.paymentTerms.trim(),
  };
}
