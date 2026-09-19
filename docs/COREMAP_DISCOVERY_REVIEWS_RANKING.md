# CoreMap Discovery, Reviews, and Ranking V1

**Status:** Phases 1–7 complete for Tourism + Universal Reviews + Food Ranking V1.  
**Audience:** engineers and curators working on discovery.  
**Source of truth:** PostgreSQL / PostGIS via Fastify API. Tiles never store review or ranking scores.

Older tourism-only notes: [`COREMAP_TOURISM_REVIEWS_RANKING_README.md`](./COREMAP_TOURISM_REVIEWS_RANKING_README.md) (historical detail; prefer this file for V1 behavior).

---

## Architecture (non-negotiable)

| Concern | Location |
|---|---|
| Universal reviews | `community.place_reviews`, `community.review_moderation_events`, `community.place_rating_summaries` |
| Tourism overlay | `tourism.place_profiles` (optional per place) |
| Tourism types | `ref.ref_tourism_types` (FK from profiles) |
| Tourism ranking weights | `tourism.ranking_configs` |
| Tourism candidate ignore | `tourism.place_candidate_ignores` |
| Place activity | `app.place_activity_daily` |
| Food ranking participation | `ref.ref_poi_categories.ranking_group = 'food_drink'` |

**Shared between Tourism Ranking and Food Ranking only:**

- universal `reviewScore` (`place-reviews.scoring`)
- contextual popularity (`place-popularity` + `app.place_activity_daily`)
- core place importance / admin-area resolution

**Not shared:** tourism `editorial_score`, `season_mode`, `manual_boost`, `editor_pick`, tourism types.

---

## 1. Universal Reviews

- Any public, non-deleted `core.core_places` row can receive reviews.
- Tables live in `community.*` (not `tourism.*`). Old `tourism.place_reviews` tables are gone.
- Public APIs: `/places/:placeId/reviews`, `/reviews/:reviewId`.
- Admin moderation: `/admin/reviews…` and Dashboard → **Reviews** (not under Tourism).
- Web: `PlaceReviewsPanel` on normal place detail for every place.
- Write eligibility: authenticated, email-verified, active user; place must be public.

Stored summary fields only: `published_review_count`, `average_rating`.  
`reviewScore` is **query-time**, never persisted.

---

## 2. Review Score Formula

```text
reviewConfidence = min(reviewCount / 20, 1)
reviewScore = 50 + ((averageRating * 20 - 50) * reviewConfidence)
```

- No published reviews → `reviewScore = 50` (neutral).
- Few reviews move the score only a little (confidence).
- At 20+ published reviews, confidence is full.

Code: `apps/api/src/modules/place-reviews/place-reviews.scoring.ts`.

---

## 3. Tourism Profile

Optional curated overlay on an existing core place:

- `tourism_type_id` → `ref.ref_tourism_types`
- `short_description`, `price_level` (1–4), `editor_pick`, `is_public`
- Ranking inputs: `editorial_score` (0–100), `manual_boost` (−10…10), `season_mode` + optional months

Create/update via admin API only. Does not duplicate `core.core_places`.

---

## 4. Tourism Types

Closed V1 codes in `ref.ref_tourism_types`:

`attraction`, `religious`, `historical`, `cultural`, `nature`, `museum`, `viewpoint`, `beach`, `waterfall`, `park`, `market`, `recreation`, `other`

API accepts **codes only** (no free-text `tourism_type` column on profiles).

---

## 5. Tourism Ranking

Geographic Tourism Recommendation Ranking V1 — **independent** township / region / national scopes (never feed one scope’s rank into another).

**Algorithm:** `coremap-tourism-ranking-v1`

Weights (`tourism.ranking_configs`):

| Scope | Editorial | Importance | Review | Popularity |
|---|---:|---:|---:|---:|
| Township | 50% | 25% | 15% | 10% |
| Region | 40% | 30% | 15% | 15% |
| National | 30% | 40% | 15% | 15% |

```text
baseScore =
  editorialScore * wE +
  importanceScore * wI +
  reviewScore * wR +
  popularityScore * wP

seasonAdjustedScore = baseScore * seasonModifier
finalScore = clamp0to100(seasonAdjustedScore + manualBoost)
```

Sort / tie-break: `finalScore DESC`, importance DESC, editorial DESC, place id ASC.  
**Rank is derived after sorting and is never manually stored or drag-reordered.**

| Editable (admin) | Calculated (read-only) |
|---|---|
| `editorial_score` | `importance_score` (from `core.core_places`) |
| `season_mode` + months | `reviewScore` (universal service) |
| `manual_boost` (+ reason if ≠ 0) | contextual `popularityScore` |
| `editor_pick` (discovery flag; not a formula weight) | `baseScore`, `finalScore`, `rank` |

APIs:

- `GET /tourism/ranking` — public list
- `GET /tourism/places/:id/geo-ranks` — place scope ranks
- `GET /admin/tourism/ranking` — admin list + breakdown
- `POST /admin/tourism/ranking/preview` — overlay proposed editable fields in memory; same scorer as public/admin

Preview body accepts **only** editable fields. Clients must not send review/popularity/importance/final/rank.

Bayesian discovery modes (`/tourism/places`) remain separate.

---

## 6. Season / Manual Boost

Season modes: `all_year`, `best_months`, `poor_months`, `temporarily_closed`.

| Mode | Modifier |
|---|---|
| `all_year` | ×1.0 |
| `best_months` (inside configured range, supports Nov–Feb wrap) | ×1.05 |
| `best_months` (outside range) | ×1.0 |
| `poor_months` (inside range) | ×0.9 |
| `poor_months` (outside range) | ×1.0 |
| `temporarily_closed` | **excluded** from ranking |

`manual_boost` defaults to `0`, range −10…10, applied after the season multiplier.  
Non-zero boost requires `manual_boost_reason` (audited with actor + before/after). Prefer editorial level for normal curation.

---

## 7. Food & Drink Township Ranking

- Scope: **township only** (no region/national food ranks in V1).
- Eligibility: public place, not deleted, category `ranking_group = 'food_drink'`, resolves to requested township.
- Seeded codes (V1): `food`, `restaurant`, `cafe`, `teashop`.
- All places stay reviewable regardless of `ranking_group`.

```text
foodScore =
  reviewScore * 0.50 +
  popularityScore * 0.30 +
  importanceScore * 0.20
```

No tourism editorial, season, type, editor pick, or manual boost.  
Optional `lat`/`lng` on the API is **display distance only** — never used in the formula.

APIs: `GET /food-drink/recommendations`, `GET /admin/food-drink/recommendations`.  
Dashboard: Core Review → **Recommendations**.  
Web: More tools → **Food & Drink** (separate from Tourism Discover).

---

## 8. Popularity Signals

Table: `app.place_activity_daily` (daily counters; no per-click event log).

30-day weights: view=1, save=4, share=4, directions=6.

Contexts:

- `tourism_township` / `tourism_region` / `tourism_national` — tourism public profiles
- `food_drink_township` — places with `ranking_group = food_drink` in that township

Score = percent-rank within the context population (0–100).  
Cold start: if total weighted activity in the population `< 20`, every place gets `popularityScore = 50`.

Does **not** write a live score into `core.core_places.popularity_score`.

---

## 9. Admin Behavior

| Area | Where |
|---|---|
| Universal review moderation | Dashboard → Reviews |
| Tourism profiles / taxonomy inputs | Tourism → Places |
| Tourism geographic ranking inspection | Tourism → Ranking |
| Tourism candidate curation | Tourism → Candidates (approve profile / ignore) |
| Food ranking inspection (read-only) | Places → Recommendations |

All writes go through the Fastify API (auth + roles + audit where required).  
Dashboard must **not** use Prisma or a Supabase client for DB writes.

Approve candidate defaults: editorial 50, season `all_year`, curator-chosen tourism type + `is_public`.  
Ignore writes `tourism.place_candidate_ignores` so the place does not keep returning.

Missing attraction: create core place (Core Review → Places → new), then attach tourism profile.

---

## 10. Public Web Behavior

- Place detail: universal reviews always.
- Tourism Discover (sidebar / More tools): tourism ranking & discovery only.
- Food & Drink (More tools): township food recommendations only.
- Tourism place detail may show geographic ranks (`#N` township/region/national) when a tourism profile exists.
- Public DTOs expose author `public_id` + `display_name` only for reviews — no emails, phones, or password fields.

---

## 11. What is deliberately NOT in V1

- Activity ranking group (non-food, non-tourism)
- Shopping ranking
- Hotel ranking
- Festivals / events
- Tourism “activities” product
- Ranking history / snapshots
- Personalization
- AI recommendation / AI candidate selection
- Complex review fraud scoring
- Redis, background workers, or materialized ranking tables
- Auto-import of tourism profiles
- Region/national Food & Drink ranks
- Restaurant editorial score or food manual boost for normal admins

---

## Key code paths

| Module | Path |
|---|---|
| Place reviews API | `apps/api/src/modules/place-reviews/` |
| Tourism API | `apps/api/src/modules/tourism/` |
| Food ranking API | `apps/api/src/modules/food-ranking/` |
| Popularity | `apps/api/src/modules/place-popularity/` |
| Web reviews | `apps/web/src/features/place-reviews/` |
| Web tourism | `apps/web/src/features/tourism/` |
| Web food | `apps/web/src/features/food-drink/` |
| Dashboard reviews | `apps/dashboard/src/features/place-review-moderation/` |
| Dashboard tourism | `apps/dashboard/src/features/tourism-moderation/` |
| Dashboard food ranking | `apps/dashboard/src/features/food-recommendations/` |

## Migrations (Phase set)

Under `infrastructure/database/migrations/supabase/`:

- `20260917023446_community_universal_place_reviews`
- `20260917024448_tourism_taxonomy_and_ranking_inputs`
- `20260917030000_tourism_reviews_ranking_foundation` (historical foundation; reviews now in `community.*`)
- `20260917060000_place_activity_daily` (+ Phase 7 drop of duplicate unique index)
- `20260917070000_tourism_ranking_configs`
- `20260917080000_poi_category_ranking_group`
- `20260917090000_tourism_place_candidate_ignores`
- `20260917100000_place_activity_daily_drop_duplicate_uidx`

Live Supabase may record MCP-applied versions with different clock timestamps; verify by **schema objects**, not filename equality alone.

## Phase 7 verification notes

- Reviews live only in `community.*`; `tourism.place_reviews` is absent.
- `ranking_group` is seeded for `food`, `restaurant`, `cafe`, `teashop` only.
- Duplicate unique index on `app.place_activity_daily (place_id, activity_date)` was removed (PK already unique).
- Supabase security advisor still reports many `rls_enabled_no_policy` INFO findings on private app schemas (including community reviews / tourism profiles). Access is via Fastify + locked schemas — treat as known legacy pattern, not Phase 7 scope.
- Public review author DTO fields: `public_id`, `display_name` only.
