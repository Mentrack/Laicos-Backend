-- Existing rows are all admin invites; the default only backfills them.
ALTER TABLE "AdminInvite" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "AdminInvite" ALTER COLUMN "role" DROP DEFAULT;
