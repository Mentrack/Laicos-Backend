import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminProfileDto } from './dto';
import { toAdminProfileDto } from './formatters/admin.formatter';

@Injectable()
export class AdminService {
  constructor(private readonly database: PrismaService) {}

  async findMine(user: User): Promise<AdminProfileDto> {
    const admin = await this.database.admin.findUnique({
      where: { userId: user.id },
    });
    if (!admin) {
      throw new NotFoundException('Admin profile not found');
    }
    return toAdminProfileDto(admin);
  }
}
