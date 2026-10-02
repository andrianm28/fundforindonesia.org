-- Which Payment Provider takes new charges, set by an Admin (prd-compliance 39).
-- Additive and append-only: the latest row is in force, and with no row the
-- deployment's PAYMENT_PROVIDER applies, so nothing is seeded or backfilled.

-- CreateTable
CREATE TABLE "PaymentProviderSetting" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "methods" TEXT[],
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProviderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentProviderSetting_setAt_idx" ON "PaymentProviderSetting"("setAt");

-- AddForeignKey
ALTER TABLE "PaymentProviderSetting" ADD CONSTRAINT "PaymentProviderSetting_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
