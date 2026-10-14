import { NotFoundException } from '@nestjs/common';
import type { Buyer, User } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';

export async function requireBuyer(
  database: PrismaService,
  user: User,
): Promise<Buyer> {
  const buyer = await database.buyer.findUnique({
    where: { userId: user.id },
  });
  if (!buyer) {
    throw new NotFoundException('Buyer profile not found');
  }
  return buyer;
}
