-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancellationReason" TEXT;

-- Hand-written: the generated diff adds NOT NULL columns with no default and
-- drops "quantity", which fails on existing rows and loses stock. Backfill
-- both quantities from "quantity" first; no reservations are tracked yet, so
-- actual and floating start equal.
ALTER TABLE "Produce" ADD COLUMN     "actualQuantity" DOUBLE PRECISION,
ADD COLUMN     "floatingQuantity" DOUBLE PRECISION;

UPDATE "Produce" SET "actualQuantity" = "quantity", "floatingQuantity" = "quantity";

ALTER TABLE "Produce" ALTER COLUMN "actualQuantity" SET NOT NULL,
ALTER COLUMN "floatingQuantity" SET NOT NULL,
DROP COLUMN "quantity";

-- Hand-written: Prisma doesn't model CHECK constraints. They back up the
-- conditional stock updates in OrderService, so a missed guard fails loudly
-- instead of overselling.
ALTER TABLE "Produce" ADD CONSTRAINT "Produce_floatingQuantity_nonnegative" CHECK ("floatingQuantity" >= 0),
ADD CONSTRAINT "Produce_floating_within_actual" CHECK ("floatingQuantity" <= "actualQuantity");
