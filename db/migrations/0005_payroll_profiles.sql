-- CreateTable
CREATE TABLE "payroll_profiles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_profiles_org_id_idx" ON "payroll_profiles"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_profiles_org_id_country_key" ON "payroll_profiles"("org_id", "country");

-- CreateIndex
CREATE INDEX "audit_log_org_id_created_at_idx" ON "audit_log"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_org_id_action_idx" ON "audit_log"("org_id", "action");
