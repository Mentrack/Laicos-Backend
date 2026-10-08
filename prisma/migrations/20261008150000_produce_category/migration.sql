-- CreateEnum
CREATE TYPE "ProduceCategory" AS ENUM ('GRAINS', 'TUBERS', 'LEGUMES', 'OILSEEDS', 'VEGETABLES', 'FRUITS', 'NUTS', 'SPICES', 'OTHER');

-- AlterTable
ALTER TABLE "Produce" ADD COLUMN     "category" "ProduceCategory";
