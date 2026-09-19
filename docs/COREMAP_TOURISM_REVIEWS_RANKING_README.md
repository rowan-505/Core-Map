# CoreMap tourism reviews and ranking

> **V1 canonical doc:** [`COREMAP_DISCOVERY_REVIEWS_RANKING.md`](./COREMAP_DISCOVERY_REVIEWS_RANKING.md)  
> This file remains as historical Phase 1–4 detail. Prefer the discovery doc for current architecture.

**Status:** Phase 1–5 tourism foundation shipped. Reviews are **universal place reviews** in `community.*`. Geographic Tourism Recommendation Ranking V1 includes admin preview/save.  
**Reviews code:** `apps/api/src/modules/place-reviews/`, `apps/web/src/features/place-reviews/`, `apps/dashboard/src/features/place-review-moderation/`.  
**Tourism overlay (profiles + discovery ranking):** `apps/api/src/modules/tourism/`, `apps/web/src/features/tourism/`, `apps/dashboard/src/features/tourism-moderation/`.  
**Place popularity:** `apps/api/src/modules/place-popularity/` (`app.place_activity_daily`).  
**Pre-implementation inspection (historical):** [`tourism-reviews-inspection.md`](./tourism-reviews-inspection.md).

## Phase 1 ownership (current)

| Concern | Location |
|---|---|
| Reviews, moderation events, rating summaries | `community.place_reviews`, `community.review_moderation_events`, `community.place_rating_summaries` |
| Tourism profile overlay | `tourism.place_profiles` only |
| Public review APIs | `/places/:placeId/reviews`, `/reviews/:reviewId`, `/admin/reviews…` |
| Dashboard moderation | `/dashboard/reviews` (not Tourism-owned) |
| Web UI | Place detail always shows `PlaceReviewsPanel` |

### Universal `reviewScore` (query-time, not stored)

```text
rawReviewScore = averageRating * 20
reviewConfidence = min(publishedReviewCount / 20, 1)
reviewScore = 50 + ((rawReviewScore - 50) * reviewConfidence)
```

No published reviews → `reviewScore = 50`. Published count + average remain the only stored summary fields.
Phase 1 does not change the tourism discovery ranking formulas below.

### Review write eligibility

- User: authenticated, `email_verified`, `is_active`, `account_status = active`, `deleted_at IS NULL`
- Place: public `core.core_places` (`deleted_at IS NULL` and `is_public`)

This document describes the **shipped behavior**. It does not describe future product ideas.

## Phase 2 taxonomy and ranking inputs

- `tourism_type` now uses the 13-code V1 taxonomy from `ref.ref_tourism_types`; dashboard and web filters no longer use legacy free-text values.
- Admin tourism profiles support six editorial score levels (20, 35, 50, 65, 80, 95), a manual boost from -10 to 10, and all-year, month-range, or temporarily-closed season settings.
- The dashboard shows the API-provided `importance_score` as read-only. Clients do not send it in profile writes.
- These fields are ranking inputs only. A new Phase 2 ranking formula is not defined in this change.

## Phase 3 place popularity metrics

- Daily counters live in `app.place_activity_daily` (`view_count`, `save_count`, `share_count`, `directions_count`).
- Weights (30-day window): view=1, save=4, share=4, directions=6.
- Popularity is **contextual** (tourism township / region / national, food_drink township). Scores are computed server-side with percent-rank normalization; nothing writes a live score into `core.core_places.popularity_score`.
- Cold start: if comparison-population total weighted points `< 20`, every place gets `popularityScore = 50`.
- Township resolution climbs `core.core_admin_areas.parent_id` — it does not assume `admin_area_id` is already a township.
- Recording hooks: place detail + place search clicks → views; new saved place → saves; new place share link → shares; successful route with `destination_place_public_id` → directions.

## Phase 4–5 Tourism Ranking V1 (geographic)

- Config: `tourism.ranking_configs` (`coremap-tourism-ranking-v1`) with independent township / region / national weights.
- Formula (query-time): weighted editorial + importance + reviewScore + contextual popularity, then season modifier + manual boost, clamp 0–100.
- `temporarily_closed` places are excluded. Existing Bayesian discovery modes are unchanged.
- APIs: `GET /tourism/ranking`, `GET /tourism/places/:id/geo-ranks`, `GET /admin/tourism/ranking` (breakdown), `POST /admin/tourism/ranking/preview` (unsaved editable overlays).
- Dashboard: Tourism → Ranking (user-style list, server preview Current→Preview, controlled inputs, Edit Tourism Data link).
- Rank is derived and never manually stored/reordered. Preview and list use the same API scorer — no client-side final score math.

---

## Purpose

Add a **tourism overlay** on existing CoreMap places, plus **universal place reviews** for any public core place:

- optional tourism profile (type, short description, price level, editor pick, public flag);
- authenticated user reviews (1–5 stars + optional title/body) on any public place;
- admin moderation queue with append-only history;
- public discovery ranking modes for tourism profiles (including query-time Bayesian “recommended”);
- tourism-related issue reports that reuse the existing feedback report contract.

Places stay in `core.core_places`. Tourism does **not** create duplicate place rows and does **not** put review data in tiles.

---

## Non-goals (explicitly out of scope)

This feature does **not** implement:

- automatic point calculation or tourism-driven rewards;
- AI recommendations or LLM ranking;
- booking, tickets, or payments;
- business / owner claiming workflows;
- review comments / replies / threads;
- helpful votes or review likes;
- streaming / Redis / Kafka popularity pipelines (Phase 3 uses daily SQL counters only);
- **cached or stored** `bayesian_score` columns (score is computed at query time only);
- **national / regional / township ranking engines** that overwrite `core.core_places.popularity_score` (Phase 3 popularity is contextual and computed in API helpers);
- fake live transit / schedules tied to tourism;
- nationwide automatic tourism profiling from OSM.

---

## Architecture rules (unchanged)

```text
PostgreSQL / PostGIS  = source of truth
Fastify API           = business logic + authorization
Web / Dashboard       = API clients only
PMTiles / MapLibre    = rendering only (no review logic in styles)
```

- No direct database access from web or dashboard.
- No Prisma / Supabase client in tourism UI code.
- Public clients never write tourism tables directly.

---

## Reused CoreMap tables

| Table / contract | Role in tourism |
|---|---|
| `core.core_places` | Place identity (`id` FK, `public_id` at API edge), visibility (`is_public`, `deleted_at`), verification, `point_geom` for nearby |
| `core.core_place_names` | Localized names on public/admin profile DTOs |
| `core.core_place_contacts` | Public contact fields (**phone / website / facebook / hours only**; email not exposed) |
| `core.core_place_addresses` + `core.core_addresses` | Optional address snippet on profile |
| `ref.ref_poi_categories` | Core place category (unchanged); tourism also stores a separate free-text `tourism_type` on the overlay |
| `app_auth.auth_users` | Review authors and moderation actors (`id` FK; JWT `sub` = `public_id`) |
| `feedback.user_reports` + `ref.ref_report_types` | Tourism issue reports (seeded codes; no new report tables) |
| `system.audit_logs` | Admin profile writes and moderation actions |

Tourism **report type codes** (seeded):

- `tourism_incorrect_type`
- `tourism_incorrect_description`
- `tourism_incorrect_price`
- `tourism_incorrect_review`
- `tourism_other`

Closed / duplicate place issues continue to use existing codes such as `closed_or_removed` / `duplicate_item`. Tourism-only report codes do **not** auto-apply canonical place edits and do **not** change ratings or rankings by themselves.

---

## Review and tourism tables

Reviews use the private `community` schema. The tourism overlay stays in the
private `tourism` schema.

| Table | Purpose |
|---|---|
| `tourism.place_profiles` | Tourism overlay only (type, description, price, editor pick, public) |
| `community.place_reviews` | Universal user reviews; soft statuses including `deleted` |
| `community.review_moderation_events` | Append-only status history |
| `community.place_rating_summaries` | Cached **published** count + average only |

### Profile fields (summary)

- `tourism_type` (trimmed text, length 1–64; free-text, not a PG enum)
- `short_description` (≤ 1000)
- `price_level` (1–4 or null)
- `editor_pick` (boolean)
- `is_public` (boolean; must also satisfy core place public/not-deleted for listing)
- `created_by` / `updated_by` → `app_auth.auth_users`

### Review fields (summary)

- `public_id` (uuid, public API id)
- `place_id`, `user_id`
- `rating` 1–5
- `title` ≤ 200, `body` ≤ 5000
- `status`: `pending` \| `published` \| `rejected` \| `hidden` \| `deleted`
- `moderation_note`, `published_at`

### Constraints / indexes of note

- Unique active review per `(place_id, user_id)` where `status <> 'deleted'` (deleted can be replaced).
- Summaries consistency: count 0 ⇒ average null; count > 0 ⇒ average present.
- Ranking helpers: indexes on summaries and published reviews; nearby uses `core.core_places_point_geom_gix` via bbox prefilter + geography `ST_DWithin`.
- Moderation events: trigger rejects `UPDATE` / `DELETE` (append-only).

### What summaries store

Only:

- `published_review_count`
- `average_rating` (published rows only)

They do **not** store Bayesian scores, popularity scores, or ranking mode results.

---

## Review lifecycle

```text
create (authenticated)
  → status = pending
  → summary refresh (published aggregates unchanged)

admin publish
  → status = published, published_at set
  → summary includes this review

author edit
  → if was published → status returns to pending (needs re-moderation)
  → otherwise status preserved (except deleted blocked)

author soft-delete
  → status = deleted
  → frees active unique slot; author may create a new review
  → published aggregates exclude deleted

admin reject / hide
  → status = rejected | hidden
  → excluded from public lists and aggregates

admin restore (hidden only)
  → if published_at was set → published
  → else → pending
  → deleted reviews cannot be restored
```

One non-deleted review per user per place. Duplicate create returns conflict (`409`).

---

## Moderation lifecycle

Admin actions (dashboard / API):

| Action | From (typical) | To |
|---|---|---|
| `publish` | pending / rejected / hidden | published (idempotent if already published) |
| `reject` | pending / published / hidden | rejected |
| `hide` | pending / published / rejected | hidden |
| `restore` | hidden only | published if ever published, else pending |

Each non-idempotent transition inserts:

1. a row in `community.review_moderation_events` (append-only);
2. a `system.audit_logs` row for sensitive admin actions.

There is **no** API to edit or delete moderation history rows.

---

## Public visibility rules

A tourism place appears in public discovery / public profile when **all** hold:

1. `core.core_places.deleted_at IS NULL`
2. `core.core_places.is_public = true`
3. matching `tourism.place_profiles` row with `is_public = true`
4. (nearby) `point_geom` present

A review appears on the public place review list only when:

1. `status = 'published'`
2. linked core place is public and not deleted

Excluded from public lists and from summary / global Bayesian inputs:

- `pending`, `rejected`, `hidden`, `deleted`

Author “my review” may return non-published statuses to the owner (including rejected / pending). Public list DTOs omit `moderation_note`.

Public author payload is limited to `public_id` + `display_name` (no email, password, phone of the user, or internal ids).

---

## API endpoints

Review module: `apps/api/src/modules/place-reviews/`. Tourism profile and
ranking routes stay in `apps/api/src/modules/tourism/`. Path params use
**public UUIDs**.

### Public

| Method | Path | Notes |
|---|---|---|
| `GET` | `/tourism/places` | Ranking modes; cursor pagination |
| `GET` | `/tourism/places/:placeId` | Public tourism profile (+ summary fields) |
| `GET` | `/places/:placeId/reviews` | Published reviews for any public place |

### Authenticated user

| Method | Path | Notes |
|---|---|---|
| `GET` | `/places/:placeId/my-review` | Owner view |
| `POST` | `/places/:placeId/reviews` | Create; rate-limited |
| `PATCH` | `/reviews/:reviewId` | Own review only; rate-limited |
| `DELETE` | `/reviews/:reviewId` | Soft-delete; rate-limited |

### Admin (`admin` or `super_admin`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/reviews` | Queue / filters / pagination |
| `GET` | `/admin/reviews/:reviewId` | Detail + moderation history |
| `POST` | `/admin/reviews/:reviewId/publish` | |
| `POST` | `/admin/reviews/:reviewId/reject` | optional note |
| `POST` | `/admin/reviews/:reviewId/hide` | optional note |
| `POST` | `/admin/reviews/:reviewId/restore` | |
| `PATCH` | `/admin/reviews/:reviewId/status` | status body; prefer action routes |
| `POST` | `/admin/tourism/places/:placeId/profile` | Create profile |
| `PATCH` | `/admin/tourism/places/:placeId/profile` | Update profile / editor pick |
| `POST` | `/admin/places/:placeId/rating-summary/refresh` | Recompute summary |

Tourism reports use existing `POST` report routes with tourism type codes / `tourism_review` target — not a separate tourism report API.

Default page size **20**, max **50**. Nearby default radius **5000 m**, max **50_000 m**.

---

## Dashboard behavior

Review routes live under `/dashboard/reviews`
(`apps/dashboard/src/features/place-review-moderation/`). Tourism place/profile
routes remain under `/dashboard/tourism/places`.

- **Reviews queue** — filter by status, place, author; cursor pagination; detail drawer / page with history.
- **Status actions** — publish / reject / hide / restore (restore only for hidden; never for deleted).
- **Places / profile editor** — create or update tourism overlay; editor pick toggle; public flag.
- **Permission denial** — API `403` surfaced as readable UI messaging.

Dashboard is API-only (no direct Supabase/Postgres).

---

## Web behavior

Reviews live in `apps/web/src/features/place-reviews/`; tourism discovery and
profile metadata stay in `apps/web/src/features/tourism/`.

- **Tourism discovery panel** — ranking mode chips, tourism type filters, loading / empty / error, load-more pagination, nearby “this area” / map-center behavior.
- **Place detail** — always shows the shared reviews panel for public place IDs.
- **Tourism section** — profile metadata only; it does not duplicate review UI.
- **Reports** — report tourism profile fields or a review via existing report modal + seeded type codes.
- Mobile-friendly list/card contracts in UI tests; no permanent wide sidebar requirement beyond existing map shell patterns.

Web never talks to Supabase for tourism data.

---

## Ranking modes

`GET /tourism/places?mode=…`

Shipped ranking is **place-level only** (one ordered list of tourism places). It is **not** a national / regional / township ranking engine: there is no separate score calculation, leaderboard, or mode keyed by country / state-region / township admin hierarchy.

| Mode | Behavior |
|---|---|
| `recommended` | Order by query-time Bayesian score (desc), then published count, verified, `public_id` |
| `top_rated` | Same Bayesian ordering, but only places with **≥ 5** published reviews |
| `most_reviewed` | Published count desc, then verified, `public_id` |
| `nearby` | Requires `lat`+`lng`; optional `radius_m`; order by distance asc |
| `editor_picks` | `editor_pick = true` only; Bayesian / fallback tie-break like recommended |

Optional filters: `tourism_type`, `bbox`, `lang`, cursor, `limit`.

`bbox` and `nearby` only **filter or sort places by map geometry**. They do not compute national-, regional-, or township-level aggregate scores.

Public response items expose published aggregates and display fields. They do **not** expose a `bayesian_score` field to clients (score is an internal ordering input).

### Not implemented: national / regional / township ranking

| Geo scope | Status in this feature |
|---|---|
| National ranking score | **Not implemented** — no formula, table, API mode, or UI |
| Regional (state / region / Naypyitaw) ranking score | **Not implemented** |
| Township ranking score | **Not implemented** |

Related but separate CoreMap concepts (not tourism ranking engines):

- `core.core_places.importance_score` / `popularity_score` — core place fields used by public map / search paths; **not** used by tourism Bayesian ranking.
- Admin hierarchy (`admin_area_id`, townships, regions) — place location metadata; **not** a tourism score engine.

If a future geo-hierarchy ranking engine is required, it needs an explicit product formula (inputs, weights, roll-up rules for national vs regional vs township) and a separate implementation pass. Do not invent that formula here.

---

## Exact Bayesian formula

Constants:

- \( m = 5 \) (`TOURISM_BAYESIAN_PRIOR_WEIGHT`)
- \( R \) = place average rating over **published** reviews
- \( v \) = place **published** review count
- \( C \) = global average rating over **all published** reviews worldwide
- Global count must be \( > 0 \) and \( C \) finite; place must have \( v > 0 \) and finite \( R \)

\[
\text{bayesian\_score} =
\left(\frac{v}{v + m}\right) R
+
\left(\frac{m}{v + m}\right) C
\]

If there are zero published reviews globally, or the place has no published reviews, the score is **null** and ranking falls back to published count → verified → `public_id`.

Hidden / rejected / deleted reviews are excluded from \( R \), \( v \), and \( C \).

---

## Why `bayesian_score` is calculated at query time

1. **Global average \( C \) changes** whenever any place’s published set changes; a stored score would go stale everywhere.
2. Summaries intentionally store only count + average — small, easy to refresh per place.
3. Ranking modes share the same formula without duplicating cached columns per mode.
4. Avoids a second write path that could drift from published-only aggregation rules.

Implementation: SQL expression in `tourism.repo.ts` list ranking query (and mirrored helper `computeTourismBayesianScore` for tests).

---

## Migrations and how to apply

| File | Purpose |
|---|---|
| `infrastructure/database/migrations/supabase/20260917030000_tourism_reviews_ranking_foundation.sql` | Schema, triggers, RLS enable, revoke from `anon`/`authenticated` |
| `infrastructure/database/migrations/supabase/20260917040000_tourism_report_types.sql` | Seed tourism report types into `ref.ref_report_types` |
| `infrastructure/database/migrations/supabase/20260917050000_tourism_production_hardening.sql` | Pin function `search_path`; actor FK indexes; reaffirm revokes |
| `infrastructure/database/verification/verify_20260917030000_tourism_reviews_ranking_foundation.sql` | Verification selects |

Matching `.rollback.sql` files exist for the foundation / report-types / hardening migrations where provided.

**Apply (typical ops):**

```bash
# Prefer the project’s normal Supabase SQL migration process.
# Example with psql against the API DATABASE_URL (privileged role):

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infrastructure/database/migrations/supabase/20260917030000_tourism_reviews_ranking_foundation.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infrastructure/database/migrations/supabase/20260917040000_tourism_report_types.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infrastructure/database/migrations/supabase/20260917050000_tourism_production_hardening.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infrastructure/database/verification/verify_20260917030000_tourism_reviews_ranking_foundation.sql
```

Supabase MCP / SQL editor may also record migrations when applying remotely; keep git SQL files as the source of truth.

Access model: RLS enabled on tourism tables **with no anon/authenticated policies**, plus schema/table privileges revoked from those roles. The Fastify API connects with a privileged Postgres role and performs authorization in application code.

---

## Permissions

| Actor | Capabilities |
|---|---|
| Anonymous | Public list / profile / published reviews |
| Authenticated `user` | Create / update / soft-delete **own** reviews; read my-review |
| `admin` / `super_admin` | All admin tourism routes (profiles, moderation, summary refresh) |
| Other roles (`viewer`, `surveyor`, …) | No admin tourism writes (API returns `403`) |

Frontend hiding is not authorization. Editor role is retired; dashboard writes use admin / super_admin.

---

## Rate limits

On authenticated review write routes (`@fastify/rate-limit`, route-scoped):

| Route class | Limit |
|---|---|
| Create review `POST …/reviews` | **20 / minute** |
| Update / soft-delete review | **30 / minute** |

---

## Tests and build commands

```bash
# API tourism unit + HTTP integration (+ report isolation in tourism folder)
cd apps/api && npm run test:tourism
cd apps/api && npm run test:reports   # includes tourism report type contract
cd apps/api && npm run typecheck
cd apps/api && npm run build

# Web (tourism tests included in test:map)
cd apps/web && npm run test:map
cd apps/web && npx tsc -b
cd apps/web && npm run build

# Dashboard tourism moderation
cd apps/dashboard && npm run test:tourism-moderation
cd apps/dashboard && npx tsc --noEmit
cd apps/dashboard && npm run build

# Shared map-style package (not tourism-specific, but part of web/dashboard builds)
npm run test:overview-style
```

---

## Known limitations

- **No national / regional / township ranking score calculation** exists in this feature; only place-level modes above.
- `tourism_type` is free-text (length-checked), not a locked DB enum; web chips are a curated filter set only.
- Tourism profiles are admin-maintained; there is no automatic OSM → tourism profile importer.
- Public ranking responses do not return raw Bayesian scores to clients.
- Dashboard review search box may send a `q` query param that the current admin list schema does not apply as full-text search (filters rely on status / place / author ids).
- Soft-deleted reviews remain as rows (status `deleted`) for history; they are not hard-deleted.
- Tourism reports never auto-mutate ratings, summaries, or rankings.
- Advisor INFO “RLS enabled, no policy” on tourism tables is **intentional** for the private-schema / API-only pattern (same family as community).

---

## Remaining production blockers / follow-ups

These are operational or product gaps, not missing core schema:

1. **Content coverage** — seed / maintain tourism profiles for priority places (Yangon / Kyauktan first); empty overlay ⇒ no tourism discovery hit.
2. **Ops runbook** — confirm staging/prod migration order and verification SQL in the normal deploy checklist.
3. **Taxonomy product decision** — optionally lock `tourism_type` vocabulary later without claiming it is done now.
4. **Geo-hierarchy ranking (optional future)** — if product needs national / regional / township engines, define the score formula and scope in a new design pass before coding.
5. **Global Supabase advisors (non-tourism)** — `pg_trgm` / `postgis` living in `public`, and many unrelated tables with RLS-and-no-policy INFO; do not “fix” those as part of tourism unless separately scoped.
6. **Abuse monitoring** — rate limits exist; ops should still watch review spam and report queues.
7. **Native mobile tourism UI** — out of V2 web-first scope unless explicitly requested.

---

## Code map

```text
apps/api/src/modules/tourism/
  tourism.routes.ts / .schema.ts / .service.ts / .repo.ts
  tourism.ranking.ts / tourism.moderation.ts / tourism.openapi.ts
  *.test.ts

apps/web/src/features/tourism/
apps/dashboard/src/features/tourism-moderation/
infrastructure/database/migrations/supabase/2026091703*tourism*
infrastructure/database/migrations/supabase/2026091704*tourism*
infrastructure/database/migrations/supabase/2026091705*tourism*
```
