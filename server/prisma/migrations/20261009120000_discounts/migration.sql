-- Referral codes and the NEW-STAR first-order code (plain column additions: existing rows are untouched).
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN "rewardCredits" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

ALTER TABLE "Order" ADD COLUMN "listPrice" INTEGER;
ALTER TABLE "Order" ADD COLUMN "discountPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "discountCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountKind" TEXT;
ALTER TABLE "Order" ADD COLUMN "referrerId" TEXT;
ALTER TABLE "Order" ADD COLUMN "rewardGiven" BOOLEAN NOT NULL DEFAULT false;
