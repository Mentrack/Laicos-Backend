-- Hand-written: backs Order.orderNumber's default. Prisma doesn't model sequences.
CREATE SEQUENCE "Order_orderNumber_seq";

-- Hand-written: the generated diff adds both columns NOT NULL in one step,
-- which fails on existing rows ("produceName" has no default) and would
-- number existing orders in arbitrary order. Add them nullable, backfill,
-- then tighten.
ALTER TABLE "Order" ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "produceName" TEXT;

-- Existing orders are numbered oldest first.
UPDATE "Order" o
SET "orderNumber" = 'ORD-' || lpad(nextval('"Order_orderNumber_seq"')::text, 6, '0')
FROM (SELECT "id" FROM "Order" ORDER BY "createdAt", "id") ordered
WHERE o."id" = ordered."id";

UPDATE "Order" o SET "produceName" = p."name" FROM "Produce" p WHERE p."id" = o."produceId";

ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET DEFAULT ('ORD-'::text || lpad((nextval('"Order_orderNumber_seq"'::regclass))::text, 6, '0'::text)),
ALTER COLUMN "orderNumber" SET NOT NULL,
ALTER COLUMN "produceName" SET NOT NULL;

-- Hand-written: tie the sequence's lifetime to the column.
ALTER SEQUENCE "Order_orderNumber_seq" OWNED BY "Order"."orderNumber";

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
