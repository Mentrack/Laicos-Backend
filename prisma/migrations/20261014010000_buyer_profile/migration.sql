-- Buyer is a 1:1 profile on User, like Farmer and Agent. Existing buyerId
-- columns keep their name and move from User.id onto Buyer.id.
CREATE SEQUENCE "Buyer_buyerId_seq";

CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL DEFAULT ('BY-'::text || lpad((nextval('"Buyer_buyerId_seq"'::regclass))::text, 6, '0'::text)),
    "userId" TEXT NOT NULL,
    "stateId" TEXT,
    "lgaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

ALTER SEQUENCE "Buyer_buyerId_seq" OWNED BY "Buyer"."buyerId";

CREATE UNIQUE INDEX "Buyer_buyerId_key" ON "Buyer"("buyerId");
CREATE UNIQUE INDEX "Buyer_userId_key" ON "Buyer"("userId");

ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_lgaId_fkey" FOREIGN KEY ("lgaId") REFERENCES "Lga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Buyer" ("id", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'BUYER';

ALTER TABLE "Order" DROP CONSTRAINT "Order_buyerId_fkey";
UPDATE "Order" AS t SET "buyerId" = b."id" FROM "Buyer" AS b WHERE b."userId" = t."buyerId";
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_buyerId_fkey";
UPDATE "CartItem" AS t SET "buyerId" = b."id" FROM "Buyer" AS b WHERE b."userId" = t."buyerId";
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartMerge" DROP CONSTRAINT "CartMerge_buyerId_fkey";
UPDATE "CartMerge" AS t SET "buyerId" = b."id" FROM "Buyer" AS b WHERE b."userId" = t."buyerId";
ALTER TABLE "CartMerge" ADD CONSTRAINT "CartMerge_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Checkout" DROP CONSTRAINT "Checkout_buyerId_fkey";
UPDATE "Checkout" AS t SET "buyerId" = b."id" FROM "Buyer" AS b WHERE b."userId" = t."buyerId";
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Address" DROP CONSTRAINT "Address_buyerId_fkey";
UPDATE "Address" AS t SET "buyerId" = b."id" FROM "Buyer" AS b WHERE b."userId" = t."buyerId";
ALTER TABLE "Address" ADD CONSTRAINT "Address_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourcingRequest" DROP CONSTRAINT "SourcingRequest_buyerId_fkey";
UPDATE "SourcingRequest" AS t SET "buyerId" = b."id" FROM "Buyer" AS b WHERE b."userId" = t."buyerId";
ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_buyerId_fkey";
UPDATE "Conversation" AS t SET "buyerId" = b."id" FROM "Buyer" AS b WHERE b."userId" = t."buyerId";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
