# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-22

First public release.

### Added

- Multi-tenant HRMS API (Express, PostgreSQL, Kysely) in a layered routes, controllers,
  services and repositories structure, with a tenant plane and a separate operator plane.
- Employees, departments, offices, org chart, directory, roles with custom permissions and
  department/office scope.
- Attendance with geofenced check-in, leave with configurable rules and balances,
  holidays from official gazettes.
- Global payroll: country rule packs, salary structures, salary-sheet import, payslip PDFs
  with QR verification, pay runs, exit pay, gratuity.
- Self-onboarding with forms, campaigns, reminders and escalation; documents with optional
  AI extraction; letters from templates; separations with settlement.
- Performance (PIPs, appraisals), work logs, wellbeing, assets, perks, AI-tool allowances,
  announcements, policies, benefits.
- Tenant web app and operator console (Next.js), shared UI and API-client packages.
- Per-workspace SES sending domains with DKIM, per-workspace PII encryption keys wrapped
  by KMS, crypto-shredding on workspace purge.
- Terraform for AWS (VPC, RDS, S3, KMS, Secrets Manager, SES, ECR, ECS Fargate behind one
  ALB, optional CloudFront and WAF, alarms and a dashboard) and a local stack on the Floci
  AWS emulator provisioned by the same modules.
- Unit, integration (under every storage, mail and key backend) and browser end-to-end
  test suites.
