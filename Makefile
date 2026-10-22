# Euron Open HRMS: developer entry points. `make` lists every target.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE_DIR := deploy/compose
FLOCI       := docker compose --env-file $(COMPOSE_DIR)/.env -f $(COMPOSE_DIR)/compose.yaml -f $(COMPOSE_DIR)/compose.floci.yaml
AWS_LOCAL   := docker compose --env-file $(COMPOSE_DIR)/.env -f $(COMPOSE_DIR)/compose.yaml -f $(COMPOSE_DIR)/compose.aws.yaml
TF_IMAGE    := hashicorp/terraform:1.16.6
TF_ENVS     := local-floci aws-dev aws-prod
# Use a local terraform when installed, otherwise the pinned container.
TF          := $(shell command -v terraform >/dev/null 2>&1 && echo terraform || echo docker run --rm -v $(CURDIR)/infra/terraform:/infra -w /infra $(TF_IMAGE))
TF_ROOT     := $(shell command -v terraform >/dev/null 2>&1 && echo infra/terraform || echo /infra)
ENV         ?= aws-dev
TAG         ?= $(shell git rev-parse --short=12 HEAD 2>/dev/null || echo dev)
TEST_DB     ?= postgres://hrms:hrms@localhost:$${HRMS_PG_PORT:-5442}/hrms_test

.PHONY: help env up up-aws down logs ps demo test test-integration test-matrix e2e lint typecheck build openapi \
        tf-fmt tf-validate tf-lint tf-security aws-plan aws-deploy aws-migrate aws-operator sanitize clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\n"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ─── Local ───────────────────────────────────────────────────────────────────

env: ## Generate deploy/compose/.env with random local-only secrets
	@scripts/gen-local-env.sh

up: env ## Start everything on emulated AWS (Floci), provisioned by the same Terraform as production
	$(FLOCI) up -d --build --wait
	@echo ""
	@echo "  web      http://localhost:$${HRMS_WEB_PORT:-3410}"
	@echo "  console  http://localhost:$${HRMS_CONSOLE_PORT:-3420}"
	@echo "  api      http://localhost:$${HRMS_API_PORT:-5005}"
	@echo "  mail     http://localhost:$${HRMS_MAILPIT_PORT:-8025}"
	@echo ""
	@echo "  Next: make demo   (two demo workspaces and an operator account)"

up-aws: env ## Start the stack against real AWS resources (needs deploy/compose/.env.aws)
	@test -f $(COMPOSE_DIR)/.env.aws || { echo "copy $(COMPOSE_DIR)/.env.aws.example to .env.aws first"; exit 1; }
	$(AWS_LOCAL) up -d --build --wait

demo: ## Seed two demo workspaces and an operator (prints the logins)
	$(FLOCI) exec -T -e DEMO_PASSWORD=$$(grep HRMS_DEMO_PASSWORD $(COMPOSE_DIR)/.env | cut -d= -f2) api node dist/cli.js demo:seed

down: ## Stop the stack and delete its volumes
	-$(FLOCI) down -v --remove-orphans
	-$(AWS_LOCAL) down -v --remove-orphans 2>/dev/null

logs: ## Tail logs (SERVICE=api|web|console|floci|...)
	$(FLOCI) logs -f --tail 100 $(SERVICE)

ps: ## Show stack status
	$(FLOCI) ps

# ─── Quality ─────────────────────────────────────────────────────────────────

lint: ## Lint every package
	pnpm lint

typecheck: ## Typecheck every package
	pnpm typecheck

test: ## Unit tests (every package)
	pnpm test

test-integration: ## API integration tests against a disposable Postgres (starts one if needed)
	@scripts/test-db.sh
	TEST_DATABASE_URL=$(TEST_DB) pnpm test:integration

test-matrix: ## Integration tests under every runtime option (storage x mail x keys, on Floci)
	@scripts/test-matrix.sh

e2e: up demo ## Browser end-to-end tests (Playwright) against the running Floci stack
	pnpm e2e

build: ## Build every package
	pnpm build

openapi: ## Regenerate docs/api/openapi.yaml from the route files
	pnpm openapi

sanitize: ## Scan committable files for credentials and cloud identifiers
	@scripts/check-sanitization.sh

# ─── Terraform ───────────────────────────────────────────────────────────────

tf-fmt: ## Format all Terraform
	$(TF) fmt -recursive $(TF_ROOT)

tf-validate: ## terraform validate every environment (no backend, no credentials)
	@for env in $(TF_ENVS); do \
	  echo "== $$env"; \
	  $(TF) -chdir=$(TF_ROOT)/envs/$$env init -backend=false -input=false -no-color >/dev/null && \
	  $(TF) -chdir=$(TF_ROOT)/envs/$$env validate -no-color || exit 1; \
	done

tf-lint: ## tflint every module and environment (plugins cached in a docker volume)
	docker run --rm -v $(CURDIR)/infra/terraform:/data -v open-hrms-tflint:/plugins -e TFLINT_PLUGIN_DIR=/plugins -w /data ghcr.io/terraform-linters/tflint:v0.64.0 --init
	docker run --rm -v $(CURDIR)/infra/terraform:/data -v open-hrms-tflint:/plugins -e TFLINT_PLUGIN_DIR=/plugins -w /data ghcr.io/terraform-linters/tflint:v0.64.0 --recursive --format compact

tf-security: ## checkov policy scan of the Terraform
	docker run --rm -v $(CURDIR)/infra/terraform:/tf bridgecrew/checkov:3.3.30 -d /tf --framework terraform --quiet --compact

# ─── AWS ─────────────────────────────────────────────────────────────────────

aws-plan: ## terraform plan for ENV (aws-dev | aws-prod); needs terraform.tfvars and AWS credentials
	cd infra/terraform/envs/$(ENV) && terraform init -input=false && terraform plan -var image_tag=$(TAG)

aws-deploy: ## One shot: registries, images, infrastructure, rollout (ENV=aws-dev|aws-prod)
	@scripts/aws-deploy.sh $(ENV) $(TAG)

aws-migrate: ## Run database migrations as a one-off ECS task (ENV=...)
	@scripts/aws-run-task.sh $(ENV) node dist/migrate.js

aws-operator: ## Create the first operator account (ENV=... EMAIL=you@example.com)
	@test -n "$(EMAIL)" || { echo "usage: make aws-operator EMAIL=you@example.com"; exit 1; }
	@scripts/aws-run-task.sh $(ENV) node dist/cli.js operator:create --email $(EMAIL)

clean: ## Remove build output
	rm -rf apps/*/dist apps/*/.next packages/*/dist .turbo
