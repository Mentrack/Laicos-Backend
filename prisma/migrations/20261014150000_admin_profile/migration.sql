-- Admin is a 1:1 profile on User, like Farmer, Agent and Buyer.
CREATE SEQUENCE "Admin_adminId_seq";

CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL DEFAULT ('AD-'::text || lpad((nextval('"Admin_adminId_seq"'::regclass))::text, 6, '0'::text)),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

ALTER SEQUENCE "Admin_adminId_seq" OWNED BY "Admin"."adminId";

CREATE UNIQUE INDEX "Admin_adminId_key" ON "Admin"("adminId");
CREATE UNIQUE INDEX "Admin_userId_key" ON "Admin"("userId");

ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Admin" ("id", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'ADMIN';
