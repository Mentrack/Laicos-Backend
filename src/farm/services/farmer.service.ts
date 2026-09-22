import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '../../../generated/client';
import {
  PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';

// Farmer rows are created with their FARMER user (AuthService.createLocalUser)
// and deleted with it (onDelete: Cascade), so there is no create or delete here.
@Injectable()
export class FarmerService {
  constructor(private readonly database: PrismaService) {}

  async findMine(user: User) {
    const farmer = await this.database.farmer.findUnique({
      where: { userId: user.id },
    });
    if (!farmer) {
      throw new NotFoundException('Farmer profile not found');
    }
    return farmer;
  }

  async findOne(id: string) {
    const farmer = await this.database.farmer.findUnique({
      where: { id },
    });
    if (!farmer) {
      throw new NotFoundException('Farmer not found');
    }
    return farmer;
  }

  async findAll(query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const [data, total] = await this.database.$transaction([
      this.database.farmer.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.farmer.count(),
    ]);
    return { data, metaData: paginationMeta(page, perPage, total) };
  }
}
