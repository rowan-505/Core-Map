# Review workflow (agent outline)

> **Note:** The Import Review product (`import_review` schema, dashboard `/import-review`, and `/api/import-review`) was permanently removed. Production data is managed through Core Review / direct editing and dedicated one-time migrations/scripts (for example `tools/data-pipeline/direct-core`).

## Current production path

```text
Core / PostGIS tables (source of truth)
→ Core Review dashboard (API-backed CRUD)
→ optional one-time direct-core / migration scripts
→ search index / tile / routing builds as needed
```

## Rules for agents

- Database is source of truth; tiles are rendering only.
- Dashboard calls API only; never connect dashboard to PostgreSQL directly.
- Destructive actions must go through API with authorization and audit.
- Schema changes require migration SQL under `infrastructure/database/migrations/`.
- Do not recreate Import Review.

## Human documentation

- [`docs/dashboard.md`](../../dashboard.md)
- [`docs/data-pipeline.md`](../../data-pipeline.md)
