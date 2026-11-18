-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SOURCING_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'SOURCING_UNANSWERED';
ALTER TYPE "NotificationType" ADD VALUE 'SOURCING_OFFER';
ALTER TYPE "NotificationType" ADD VALUE 'SOURCING_OFFER_WITHDRAWN';
ALTER TYPE "NotificationType" ADD VALUE 'SOURCING_CONTRACT_READY';
ALTER TYPE "NotificationType" ADD VALUE 'SOURCING_PAYMENT_READY';
ALTER TYPE "NotificationType" ADD VALUE 'SOURCING_SUPPLY_SHORT';

