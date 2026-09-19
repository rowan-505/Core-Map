-- =============================================================================
-- 20260917060000_place_activity_daily.sql
-- -----------------------------------------------------------------------------
-- Phase 3: minimal reusable place popularity activity storage.
-- Daily counters only (no per-click event log, no Redis, no ranking snapshots).
-- Does NOT write a global popularity score into core.core_places.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS app.place_activity_daily (
    place_id         bigint      NOT NULL
        REFERENCES core.core_places (id) ON DELETE CASCADE,
    activity_date    date        NOT NULL,
    view_count       integer     NOT NULL DEFAULT 0,
    save_count       integer     NOT NULL DEFAULT 0,
    share_count      integer     NOT NULL DEFAULT 0,
    directions_count integer     NOT NULL DEFAULT 0,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT place_activity_daily_pkey PRIMARY KEY (place_id, activity_date),
    CONSTRAINT place_activity_daily_view_count_chk CHECK (view_count >= 0),
    CONSTRAINT place_activity_daily_save_count_chk CHECK (save_count >= 0),
    CONSTRAINT place_activity_daily_share_count_chk CHECK (share_count >= 0),
    CONSTRAINT place_activity_daily_directions_count_chk CHECK (directions_count >= 0)
);

-- PRIMARY KEY (place_id, activity_date) already enforces uniqueness.
-- Do not add a duplicate unique index on the same columns.

CREATE INDEX IF NOT EXISTS place_activity_daily_date_idx
    ON app.place_activity_daily (activity_date DESC);

CREATE INDEX IF NOT EXISTS place_activity_daily_place_date_desc_idx
    ON app.place_activity_daily (place_id, activity_date DESC);

COMMENT ON TABLE app.place_activity_daily IS
    'Daily place engagement counters for contextual popularity (views/saves/shares/directions). No per-click event stream.';

COMMENT ON COLUMN app.place_activity_daily.view_count IS
    'Place detail opens and/or place search-result clicks aggregated per UTC day.';
COMMENT ON COLUMN app.place_activity_daily.save_count IS
    'Successful app.user_saved_places inserts for entity_type=place.';
COMMENT ON COLUMN app.place_activity_daily.share_count IS
    'Successful new share.share_links creates for target_type=place.';
COMMENT ON COLUMN app.place_activity_daily.directions_count IS
    'Successful routing requests attributed to a destination place.';

-- ---------------------------------------------------------------------------
-- Best-effort 30-day backfill from existing trustworthy signals.
-- ---------------------------------------------------------------------------

-- Search result clicks on places → views
INSERT INTO app.place_activity_daily AS d (
    place_id,
    activity_date,
    view_count,
    save_count,
    share_count,
    directions_count,
    updated_at
)
SELECT
    c.entity_id AS place_id,
    (c.created_at AT TIME ZONE 'UTC')::date AS activity_date,
    COUNT(*)::integer AS view_count,
    0,
    0,
    0,
    now()
FROM search.search_result_click_events AS c
INNER JOIN core.core_places AS p ON p.id = c.entity_id
WHERE c.entity_type = 'place'
  AND c.created_at >= (now() AT TIME ZONE 'UTC') - interval '30 days'
GROUP BY c.entity_id, (c.created_at AT TIME ZONE 'UTC')::date
ON CONFLICT (place_id, activity_date) DO UPDATE
SET
    view_count = d.view_count + EXCLUDED.view_count,
    updated_at = now();

-- Saved places → saves
INSERT INTO app.place_activity_daily AS d (
    place_id,
    activity_date,
    view_count,
    save_count,
    share_count,
    directions_count,
    updated_at
)
SELECT
    s.entity_id AS place_id,
    (s.created_at AT TIME ZONE 'UTC')::date AS activity_date,
    0,
    COUNT(*)::integer AS save_count,
    0,
    0,
    now()
FROM app.user_saved_places AS s
INNER JOIN core.core_places AS p ON p.id = s.entity_id
WHERE s.entity_type = 'place'
  AND s.entity_id IS NOT NULL
  AND s.created_at >= (now() AT TIME ZONE 'UTC') - interval '30 days'
GROUP BY s.entity_id, (s.created_at AT TIME ZONE 'UTC')::date
ON CONFLICT (place_id, activity_date) DO UPDATE
SET
    save_count = d.save_count + EXCLUDED.save_count,
    updated_at = now();

-- Place share link creates → shares (one per link; not access_count)
INSERT INTO app.place_activity_daily AS d (
    place_id,
    activity_date,
    view_count,
    save_count,
    share_count,
    directions_count,
    updated_at
)
SELECT
    p.id AS place_id,
    (sl.created_at AT TIME ZONE 'UTC')::date AS activity_date,
    0,
    0,
    COUNT(*)::integer AS share_count,
    0,
    now()
FROM share.share_links AS sl
INNER JOIN core.core_places AS p ON p.public_id = sl.place_public_id
WHERE sl.target_type = 'place'
  AND sl.place_public_id IS NOT NULL
  AND sl.created_at >= (now() AT TIME ZONE 'UTC') - interval '30 days'
GROUP BY p.id, (sl.created_at AT TIME ZONE 'UTC')::date
ON CONFLICT (place_id, activity_date) DO UPDATE
SET
    share_count = d.share_count + EXCLUDED.share_count,
    updated_at = now();

COMMIT;
