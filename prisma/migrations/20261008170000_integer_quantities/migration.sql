-- Hand-written guard: produce is sold in whole units. Casting would round any
-- fractional stock or order quantity silently, so refuse instead and let a
-- person decide what those rows should become.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Produce"
    WHERE "quantity" <> trunc("quantity")
       OR "actualQuantity" <> trunc("actualQuantity")
       OR "floatingQuantity" <> trunc("floatingQuantity")
  ) OR EXISTS (SELECT 1 FROM "Order" WHERE "quantity" <> trunc("quantity"))
    OR EXISTS (SELECT 1 FROM "CartItem" WHERE "quantity" <> trunc("quantity"))
  THEN
    RAISE EXCEPTION 'Fractional quantities exist; fix them before converting to integer';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "CartItem" ALTER COLUMN "quantity" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "quantity" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "Produce" ALTER COLUMN "quantity" SET DATA TYPE INTEGER,
ALTER COLUMN "actualQuantity" SET DATA TYPE INTEGER,
ALTER COLUMN "floatingQuantity" SET DATA TYPE INTEGER;
