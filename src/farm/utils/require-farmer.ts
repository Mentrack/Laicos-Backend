import { NotFoundException } from '@nestjs/common';
import type { Farmer, User } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';

export async function requireFarmer(
  database: PrismaService,
  user: User,
): Promise<Farmer> {
  const farmer = await database.farmer.findUnique({
    where: { userId: user.id },
  });
  if (!farmer) {
    throw new NotFoundException('Farmer profile not found');
  }
  return farmer;
}
