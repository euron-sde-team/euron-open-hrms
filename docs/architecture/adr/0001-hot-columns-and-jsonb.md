# ADR 0001: Hot columns plus a JSONB document per row

## Status

Accepted.

## Context

HR data has a small, stable core and a long, shifting tail. The core (which workspace a row
belongs to, which employee, which leave type, its status, its date) is what the
application filters, joins, counts and keeps unique. The tail varies by country (statutory
identifiers, payroll components), by workspace configuration (custom onboarding fields,
letter templates, leave rules) and over time as features grow. A fully normalised schema
would need a migration for most feature changes and a wide, sparse table for employee
attributes. A schemaless store would give up the indexes and uniqueness the core needs.

The project also wanted every runtime query to go through one data-access layer, so tenant
scoping and personal-data encryption could be applied in a single place.

## Decision

Every application table has the same shape: `id`, `org_id` for tenant tables, a few **hot
columns**, a `data JSONB` column, and `created_at` / `updated_at`.

- A hot column is anything the database must filter, join, index or keep unique: foreign
  ids, `status`, dates, `email`, `code`, `token_hash`.
- Everything else lives in `data`.
- The repository (`apps/api/src/repositories/base.repository.ts`) presents each row as one
  flat object (`{ ...data, ...hotColumns, id, createdAt, updatedAt }`) and splits objects back
  on write, using a per-table list of hot columns.
- SQL filters (`where`, `page`, `removeWhere`) accept only hot columns and throw otherwise.

## Consequences

Positive:

- Most features add fields without a migration; the eight migration files to date are
  almost entirely new tables.
- One serializer handles every table, which is what makes structural tenant scoping and
  field-level encryption ([ADR 0005](0005-pii-envelope-encryption.md)) possible in one place.
- Sealed fields can only ever be `data` keys, which keeps ciphertext out of anything the
  database must query.

Trade-offs:

- No database-level type or `NOT NULL` checks inside `data`; validation lives in services
  and `core/validate.ts`.
- No foreign keys. Relationships are by id; referential integrity and cascading deletes are
  the services' job (`removeWhere`).
- Filtering on a non-hot field means loading the workspace's rows and filtering in the
  application (`find(pred)`). That is acceptable at workspace scale and is the signal to
  promote a field to a hot column, which takes a migration.
- Promoting a field later needs a backfill from `data` into the new column.
- Reporting tools that read the database directly must understand the JSONB layout.

## Alternatives considered

- **Fully normalised relational schema.** Strongest integrity and the easiest ad-hoc SQL,
  but every country- or workspace-specific attribute becomes a migration or an
  entity-attribute-value table.
- **Document store.** Flexible, but loses transactional joins, uniqueness and the mature
  operational tooling of Postgres on RDS.
- **JSONB only, with expression indexes.** Avoids deciding hot columns up front, but makes
  uniqueness and joins awkward and hides the important fields from anyone reading the
  schema.
