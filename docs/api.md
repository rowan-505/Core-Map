# API


> **Note:** The Import Review product (`import_review` schema, dashboard `/import-review`, and `/api/import-review`) was permanently removed. Production data is managed through Core Review / direct editing and dedicated one-time migrations/scripts (for example `tools/data-pipeline/direct-core`).

Fastify + TypeScript + Zod. This is the only app that accesses the database.

## Run

```bash
cd apps/api && npm install && npm run prisma:generate && npm run dev
```

- App: http://localhost:3001
- Swagger: http://localhost:3001/docs
- Generated ref: [`apps/api/docs/API.md`](../apps/api/docs/API.md)

## Module pattern

```text
apps/api/src/modules/<domain>/
  <domain>.routes.ts → schema → service → repo
```

Keep route handlers thin. Use raw SQL for geospatial and search-heavy work.

A good first module is [`places`](../apps/api/src/modules/places/). Transport is larger; read it after the pattern is clear.

## Main route groups

| Path | Purpose |
|------|---------|
| `/health` | Health |
| `/auth/*` | Sessions / accounts |
| `/public/*` | Public map search and details |
| `/core-review/*` | Dashboard entity review |
| `/api/routing/*` | Directions (Valhalla adapter) |

## Auth rule

Frontend hiding is not security. Every protected action must check permissions in the API.

Entry: `src/server.ts` → `src/app.ts`.
