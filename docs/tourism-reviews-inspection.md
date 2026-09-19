# Tourism / reviews inspection (read-only)

> **Superseded for implemented behavior.** See [`COREMAP_TOURISM_REVIEWS_RANKING_README.md`](./COREMAP_TOURISM_REVIEWS_RANKING_README.md) for the final tourism/review/ranking system. This file remains as the pre-build inspection snapshot.

**Date:** 2026-09-17  
**Scope:** Repo + linked Supabase project `Map Project` (`locghyuranqaqsnbxflc`, ap-northeast-1).  
**Mode:** Read-only. No code, migration, database, or doc changes beyond this report.

Missing planning docs at inspection time: `V2_PRODUCTION_IMPLEMENTATION_PLAN.md`, `COREMAP_TOURISM_REVIEWS_RANKING_README.md`. Used `AGENTS.md`, `docs/roadmap.md`, and live schema/code instead.

---

## Confirmations (short answers)

| Question | Answer |
|---|---|
| Is `core.core_places.id` the correct place FK? | **Yes** for internal FKs (`bigint` PK). Public APIs use `public_id` (uuid). |
| Is `app_auth.auth_users.id` the correct user FK? | **Yes** for internal FKs (`bigint` PK). JWT `sub` is `auth_users.public_id`. |
| How does the API DB connection relate to RLS? | API uses Prisma + `DATABASE_URL` as a privileged Postgres role (`postgres` / pooler user with `rolbypassrls`). Private app schemas are **revoked from `anon`/`authenticated`** (migration 186). Authorization is **Fastify JWT + roles**, not Supabase Data API RLS. |
| New `tourism_type` field vs existing categories? | **Prefer the existing category system** (`category_id` → `ref.ref_poi_categories`). Do **not** add a redundant `tourism_type` on `core_places`. Extend categories and/or add a **side profile table** keyed by `place_id` for tourism-only attributes. |

---

## 1. Core place tables and primary keys

**Primary table:** `core.core_places`

- PK: `id` `bigint`
- Unique public key: `public_id` `uuid` (default `gen_random_uuid()`)
- Soft delete: `deleted_at`
- Geometry: `point_geom` (required), `entry_geom`, `footprint_geom`; also denormalized `lat`/`lng`
- Scores (0–100 style numeric): `importance_score`, `popularity_score`, `confidence_score`
- Visibility: `is_public`, `is_verified`
- Category: `category_id` → `ref.ref_poi_categories(id)` (required)
- Admin: `admin_area_id` → `core.core_admin_areas(id)`
- Verification: `verification_status`, `verified_at`, `verified_by` → `app_auth.auth_users(id)`, `verification_note`
- Allowed `verification_status`: `unverified`, `verified`, `needs_fix`, `questionable`, `rejected_after_core_review`

**Satellite tables** (all FK `place_id` → `core.core_places.id`):

| Table | Role |
|---|---|
| `core.core_place_names` | Localized / alternate names |
| `core.core_place_contacts` | phone, website, facebook_url, opening_hours, email |
| `core.core_place_addresses` | M2M to `core.core_addresses` |
| `core.core_place_buildings` | M2M to `core.core_buildings` |
| `core.core_place_sources` | Provenance |
| `core.core_place_versions` | Version snapshots |

**Live counts (2026-09-17):** ~64,193 active places; 2,549 `hotel`; ~16,276 in tourism-adjacent codes (`hotel`, `pagoda`, `monastery`, `restaurant`, `cafe`, `entertainment`).

---

## 2. Names, contacts, addresses, categories, verification

**Names** (`core.core_place_names`): `name`, `language_code`, `script_code`, `name_type`, `is_primary`, `search_weight`. Parent also stores `primary_name` / `display_name`.

**Contacts** (`core.core_place_contacts`): one-row-style contact fields per place (`phone`, `website`, `facebook_url`, `opening_hours`, `email`).

**Addresses** (`core.core_place_addresses` → `core.core_addresses`): formal address components (`full_address`, house/unit, street, admin hierarchy text fields, `plus_code`/`postal_code`, geometry, verification fields). Relation has `relation_type`, `is_primary`.

**Categories:** `ref.ref_poi_categories` (~58 rows). Parent/child via `parent_id`. Examples: food/health/education/transport/religion (`pagoda`, `monastery`), `hotel`, `entertainment`. **No dedicated tourism parent**, no `attraction` / `museum` / `viewpoint` codes found.

**Verification on places:** boolean `is_verified` plus structured `verification_*` columns (see §1).

---

## 3. Auth user table and authenticated-user helper

**Table:** `app_auth.auth_users`

- PK: `id` `bigint`
- Unique: `public_id` `uuid`, `email`
- Fields: `password_hash`, `display_name`, `is_active`, `email_verified`, `account_status`, `preferred_language`, `deleted_at`, etc.

**Roles:** `app_auth.auth_roles` + `app_auth.auth_user_roles`  
Live role codes: `user`, `viewer`, `surveyor`, `admin`, `super_admin`.

**Authenticated helper (API):**

- Plugin: `apps/api/src/plugins/auth.ts`
- Decorator: `app.authenticate` (JWT verify; production requires `sid`; reloads roles from active session)
- JWT `sub` = `auth_users.public_id` (see `auth.service.ts` `toAccessTokenClaims`)
- Repos resolve user by `public_id` then use internal `id` for FKs

There is **no** separate `auth_permissions` table. Access is **role-based**.

---

## 4. Admin role and permission checks

Defined in `apps/api/src/plugins/auth.ts`:

| Helper | Roles |
|---|---|
| `requireDashboardAccess` | `viewer`, `admin`, `super_admin` |
| `requireDashboardWrite` | `admin`, `super_admin` |
| `requireReportsReview` | same as write |
| `requireRole(...codes)` | factory after `authenticate` |
| Field survey | `surveyor` (+ managers = admin/super_admin) |

Frontend hiding is not authorization; routes attach `preHandler: [app.authenticate, …]`.

---

## 5. API module and route registration

**Pattern:** `apps/api/src/modules/<domain>/` → `*.routes.ts` / `*.schema.ts` / `*.service.ts` / `*.repo.ts` (+ openapi where used).

**Registration:** `apps/api/src/app.ts` registers domain plugins (auth, places, public-map, reports, community, core-review, transport, field, …).

**Place-relevant routes:**

- Dashboard CRUD: `/places`, `/places/:id` (auth + dashboard roles) — `places` module
- Public: `/public/places`, `/public/places/:id`, `/public/search`, `/public/map/places` — `public-map` module
- Reports: `/reports`, `/me/reports`, `/admin/reports…` — `reports` module

No tourism/reviews module exists.

---

## 6. Prisma vs raw SQL conventions

- Prisma schema: `apps/api/prisma/schema.prisma` (partial model coverage; multi-schema including `core`, `app_auth`, `system`, `community`, …)
- Connection: `apps/api/src/db/prisma.ts` → `DATABASE_URL` via `PrismaClient`
- Geospatial / search / heavy joins: **`$queryRaw` / `$executeRaw`** in repos (places, public-map, reports, community, …)
- Simple CRUD: Prisma models where already mapped

**Convention for new tourism tables:** SQL migration first; repo with raw SQL for ranked queries; Prisma model only if it fits existing patterns.

---

## 7. Migration directory and apply command

**Directory:**

```text
infrastructure/database/migrations/
  local/       # local raw/staging
  supabase/    # production DDL (apply in filename order)
```

Latest examples: `20260917010000_community_production_contract.sql`, `20260917020000_community_notifications_contract.sql`.

**There is no npm `migrate` script.** Documented apply pattern:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/database/migrations/supabase/<file>.sql
```

Also: Supabase SQL Editor, then optional `seeds/supabase/` and `checks/supabase/`.  
Introspection only: `npm run db:erd:supabase` / `db:schema:local`.  
MCP is configured read-only; do not use MCP to apply DDL.

---

## 8. Audit-log implementation

**Table:** `system.audit_logs`

Columns: `id`, `actor_user_id` → users, `action_type`, `entity_type`, `entity_id`, `before_snapshot`, `after_snapshot`, `ip_address`, `user_agent`, `created_at`.

**Writers:** Prisma `auditLog.create` (auth, admin-users) and raw `INSERT INTO system.audit_logs` (reports, media, search maintenance, repair SQL). Domain-specific logs also exist (e.g. `transport.transport_audit_logs`).

RLS enabled on `system.audit_logs` (true); still private from anon via schema revoke.

---

## 9. Feedback / report implementation

**Schema `feedback`:**

- `user_reports` — main report row (`created_by` → `auth_users.id`, optional anonymous, `target_entity_type` / `target_entity_id` / `target_public_id`, status/type/reason codes, geom, review fields, points link, optional `survey_session_id`)
- `report_status_events`, `report_followups`, `report_media`

**API:** `apps/api/src/modules/reports/` — public create + user list; admin review/apply/reward/delete with `requireReportsReview` and audit.

This is **map issue / contribution reports**, not star ratings or tourism reviews.

---

## 10. Public place search and place-detail UI

**Web (`apps/web`):**

- Search: `features/filters/components/SearchPanel.tsx` + `features/poi/api/publicSearch*.ts` → `GET /public/search`
- Detail: `features/poi/components/PlaceDetailPanel.tsx` — names, category, reverse address, save, report, share, route from/to
- Map markers: `features/map/lib/maplibre/placesOnMap.ts`

**No** review list, rating stars, or ranking UI on place detail.

---

## 11. Dashboard table / drawer / modal / filter / pagination

Reusable shells already exist — prefer these over new one-offs:

| Pattern | Location |
|---|---|
| Page shell + table + filters | `components/core-review/CoreReview*` |
| Review family shell | `components/review/ReviewFamilyPageShell.tsx` |
| Table card | `ReviewTableCard.tsx` / `CoreReviewDataTableCard.tsx` |
| Filters | `ReviewFilterCard.tsx` / `CoreReviewFilterCard.tsx` |
| Detail drawer | `ReviewDetailDrawer.tsx` |
| Pagination | `ReviewPagination.tsx` |
| Place edit modal | `components/places/PlaceEditModal.tsx` |
| POI category picker | `components/poi-categories/PoiCategoryCombobox.tsx` |
| Toolbar | `components/dashboard/DataTableToolbar.tsx` |

Feature pages (reports, community moderation, transport) compose these patterns.

---

## 12. Tourism / review / rating / ranking / recommendation tables

**None found** for tourism product reviews, star ratings, rankings, or recommendations.

“Review” tables that **do** exist are operational, not tourist reviews:

- `import_review.review_*` — import candidate review
- `system.system_review_*` — system repair review
- `community.*` — local news posts/reactions (not place ratings)

No `tourism` schema. No `*_ratings`, `*_reviews` (consumer), or recommendation tables.

---

## Architecture notes for a future tourism phase

1. **Do not duplicate places.** Link any tourism profile / review rows to `core.core_places.id` (store `public_id` only at API edges if needed).
2. **Classify with `ref.ref_poi_categories`.** Add missing tourism codes (e.g. attraction, museum) under a clear parent if needed; avoid a parallel `tourism_type` column on `core_places`.
3. **Optional profile overlay:** e.g. `tourism.place_profiles(place_id PK/FK → core_places.id)` for fee, visit tips, ranking caches — keeps core places clean.
4. **Users:** FK `user_id` → `app_auth.auth_users.id`; resolve from JWT `sub` (`public_id`) in service/repo.
5. **Authz:** reuse `app.authenticate` + role helpers; audit admin moderation via `system.audit_logs`.
6. **Clients:** web/dashboard call API only; reuse place detail + dashboard review shells.
7. **AGENTS.md** currently lists “social feed, public reviews, or ratings” as out of V2 unless explicitly requested — treat tourism reviews as an explicit override when implementing.

---

## Adjacent security note (existing, not tourism)

Supabase MCP `list_tables` advisory: `public.spatial_ref_sys` and `public._prisma_migrations` have RLS disabled. Application data lives in private schemas revoked from `anon`/`authenticated` (migration 186). Not introduced by tourism work; listed for awareness only.

---

## Evidence sources

- Live SQL against Supabase project `locghyuranqaqsnbxflc`
- `apps/api/prisma/schema.prisma`, `plugins/auth.ts`, `plugins/prisma.ts`, `app.ts`
- `apps/api/src/modules/{places,public-map,reports,auth}/`
- `apps/web/src/features/poi/`
- `apps/dashboard/src/components/{review,core-review,places}/`
- `infrastructure/database/migrations/supabase/186_lock_private_application_schemas.sql`
- `infrastructure/database/README.md`, `docs/database.md`
