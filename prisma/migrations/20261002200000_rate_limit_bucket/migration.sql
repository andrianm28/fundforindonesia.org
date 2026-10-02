-- csr-06b: shared counters for rate-limiting public endpoints. Additive, new
-- table. subjectHash is an HMAC of the caller's address, never the address.
-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "scope" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("scope","subjectHash","windowStart")
);

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");
