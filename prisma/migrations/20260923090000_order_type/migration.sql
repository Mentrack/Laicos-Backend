-- Hand-written: the generated diff adds "type" NOT NULL with no default,
-- which fails on existing rows. Backfill each order from its produce first.
ALTER TABLE "Order" ADD COLUMN     "type" "ProduceType";

UPDATE "Order" o SET "type" = p."type" FROM "Produce" p WHERE p."id" = o."produceId";

ALTER TABLE "Order" ALTER COLUMN "type" SET NOT NULL;
