-- AlterTable: add nullable clerkUserId identity column for Clerk-based auth
ALTER TABLE "User" ADD COLUMN "clerkUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");
