-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'READY';

-- Hand-written: the generated diff adds "quantity" NOT NULL with no default,
-- which fails on existing rows. Backfill from "actualQuantity" first — for
-- every row so far, actual has only ever mirrored the original listed stock.
ALTER TABLE "Produce" ADD COLUMN     "quantity" DOUBLE PRECISION;

UPDATE "Produce" SET "quantity" = "actualQuantity";

ALTER TABLE "Produce" ALTER COLUMN "quantity" SET NOT NULL;
