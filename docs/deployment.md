# Deployment

| Piece | Host |
|-------|------|
| Web + Dashboard | Vercel |
| API (+ Martin if used) | Render (or current host) |
| Database | Supabase (PostGIS) |
| Tiles | Cloudflare R2 / CDN |

## Before production

- API auth on protected routes
- Zod validation + rate limits on sensitive paths
- CORS locked (`CORS_ORIGIN`)
- Secrets not in frontend
- Migrations applied and indexed
- Audit for admin / destructive actions
- Tile packages published with checksum / version
- Routing build smoke-tested if shipping directions

## Check locally first

1. `curl` health and OpenAPI.
2. Web map loads basemap + search.
3. Dashboard login and one review page.
4. No direct DB from clients.

## Field report resolution (admin apply)

Before promoting `POST /admin/reports/:id/apply`:

1. `npm run test:reports` in `apps/api` and `apps/dashboard`.
2. On disposable PostGIS only (`127.0.0.1` + DB `coremap_field_test`):
   `DATABASE_URL=... NODE_ENV=test npm run verify:reports-apply-db`
3. Confirm no new migration is required for the candidate commit (current apply uses existing feedback/transport/audit tables).
4. Staging must report READY FOR PRODUCTION before any production deploy.
5. Production first apply: one real low-risk report only; verify audit + idempotent retry.

App-specific notes stay next to code READMEs under `apps/` and `infrastructure/`.
