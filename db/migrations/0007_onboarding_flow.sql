-- CreateTable
CREATE TABLE "onboarding_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "status" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_cases" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "invite_id" TEXT,
    "campaign_id" TEXT,
    "template_id" TEXT,
    "status" TEXT,
    "due_at" TIMESTAMP(3),
    "token_hash" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_campaigns" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "status" TEXT,
    "due_at" TIMESTAMP(3),
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onboarding_templates_org_id_idx" ON "onboarding_templates"("org_id");

-- CreateIndex
CREATE INDEX "onboarding_templates_org_id_status_idx" ON "onboarding_templates"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_cases_token_hash_key" ON "onboarding_cases"("token_hash");

-- CreateIndex
CREATE INDEX "onboarding_cases_org_id_idx" ON "onboarding_cases"("org_id");

-- CreateIndex
CREATE INDEX "onboarding_cases_org_id_status_idx" ON "onboarding_cases"("org_id", "status");

-- CreateIndex
CREATE INDEX "onboarding_cases_employee_id_idx" ON "onboarding_cases"("employee_id");

-- CreateIndex
CREATE INDEX "onboarding_cases_campaign_id_idx" ON "onboarding_cases"("campaign_id");

-- CreateIndex
CREATE INDEX "onboarding_cases_status_due_at_idx" ON "onboarding_cases"("status", "due_at");

-- CreateIndex
CREATE INDEX "onboarding_campaigns_org_id_idx" ON "onboarding_campaigns"("org_id");

-- CreateIndex
CREATE INDEX "onboarding_campaigns_org_id_status_idx" ON "onboarding_campaigns"("org_id", "status");
