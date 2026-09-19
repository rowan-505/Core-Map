-- =============================================================================
-- 20260917110000_tourism_activities_events_foundation.sql
-- -----------------------------------------------------------------------------
-- Phase 1: Tourism Activities + Events/Festivals database foundation.
-- Taxonomies in ref.*; curated entities in tourism.*.
-- No festivals table — festival is an event type.
-- No ranking/review/popularity/booking fields.
-- Access: API-only (RLS on, no anon/authenticated policies; schema revoked).
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- ----------------------------------------------------------------------------
-- A. Activity taxonomy
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ref.ref_activity_types (
    id           bigserial PRIMARY KEY,
    code         text        NOT NULL,
    name_en      text        NOT NULL,
    name_mm      text,
    description  text,
    sort_order   integer     NOT NULL DEFAULT 100,
    is_active    boolean     NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ref_activity_types_code_key UNIQUE (code),
    CONSTRAINT ref_activity_types_code_chk
        CHECK (code = lower(btrim(code)) AND code ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT ref_activity_types_name_en_chk
        CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS ref_activity_types_active_sort_idx
    ON ref.ref_activity_types (is_active, sort_order, id);

COMMENT ON TABLE ref.ref_activity_types IS
    'V1 tourism activity type taxonomy for tourism.activities.activity_type_id.';

INSERT INTO ref.ref_activity_types (code, name_en, name_mm, description, sort_order, is_active)
VALUES
    ('sightseeing', 'Sightseeing', NULL, 'General sightseeing activity', 10, true),
    ('hiking', 'Hiking', NULL, 'Hiking or trekking', 20, true),
    ('cycling', 'Cycling', NULL, 'Cycling activity', 30, true),
    ('boat_trip', 'Boat trip', NULL, 'Boat or ferry trip', 40, true),
    ('food_experience', 'Food experience', NULL, 'Food tasting or culinary experience', 50, true),
    ('cultural_experience', 'Cultural experience', NULL, 'Cultural experience or performance', 60, true),
    ('workshop', 'Workshop', NULL, 'Workshop or class', 70, true),
    ('nature_activity', 'Nature activity', NULL, 'Nature-based activity', 80, true),
    ('water_activity', 'Water activity', NULL, 'Water sports or water recreation', 90, true),
    ('photography', 'Photography', NULL, 'Photography-focused activity', 100, true),
    ('other', 'Other', NULL, 'Unclassified or other activity', 999, true)
ON CONFLICT (code) DO UPDATE
SET
    name_en = EXCLUDED.name_en,
    name_mm = EXCLUDED.name_mm,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- B. Event taxonomy (festival is a type — no tourism.festivals table)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ref.ref_event_types (
    id           bigserial PRIMARY KEY,
    code         text        NOT NULL,
    name_en      text        NOT NULL,
    name_mm      text,
    description  text,
    sort_order   integer     NOT NULL DEFAULT 100,
    is_active    boolean     NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ref_event_types_code_key UNIQUE (code),
    CONSTRAINT ref_event_types_code_chk
        CHECK (code = lower(btrim(code)) AND code ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT ref_event_types_name_en_chk
        CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS ref_event_types_active_sort_idx
    ON ref.ref_event_types (is_active, sort_order, id);

COMMENT ON TABLE ref.ref_event_types IS
    'V1 tourism event/festival type taxonomy for tourism.events.event_type_id.';

INSERT INTO ref.ref_event_types (code, name_en, name_mm, description, sort_order, is_active)
VALUES
    ('festival', 'Festival', NULL, 'Festival', 10, true),
    ('religious_event', 'Religious event', NULL, 'Religious ceremony or holiday event', 20, true),
    ('cultural_event', 'Cultural event', NULL, 'Cultural event', 30, true),
    ('market_event', 'Market event', NULL, 'Market or bazaar event', 40, true),
    ('concert', 'Concert', NULL, 'Concert or music performance', 50, true),
    ('sports_event', 'Sports event', NULL, 'Sports event', 60, true),
    ('seasonal_event', 'Seasonal event', NULL, 'Seasonal celebration or event', 70, true),
    ('public_celebration', 'Public celebration', NULL, 'Public celebration', 80, true),
    ('other', 'Other', NULL, 'Unclassified or other event', 999, true)
ON CONFLICT (code) DO UPDATE
SET
    name_en = EXCLUDED.name_en,
    name_mm = EXCLUDED.name_mm,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- C. tourism.activities
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tourism.activities (
    id                         bigserial PRIMARY KEY,
    public_id                  uuid         NOT NULL DEFAULT gen_random_uuid(),
    name                       text         NOT NULL,
    short_description          text,
    activity_type_id           bigint       NOT NULL
        REFERENCES ref.ref_activity_types (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    primary_place_id           bigint
        REFERENCES core.core_places (id) ON DELETE SET NULL ON UPDATE CASCADE,
    admin_area_id              bigint       NOT NULL
        REFERENCES core.core_admin_areas (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    is_active                  boolean      NOT NULL DEFAULT true,
    is_verified                boolean      NOT NULL DEFAULT false,
    season_mode                text         NOT NULL DEFAULT 'all_year',
    season_start_month         smallint,
    season_end_month           smallint,
    display_priority           integer      NOT NULL DEFAULT 0,
    requires_schedule_review   boolean      NOT NULL DEFAULT false,
    last_schedule_reviewed_at  timestamptz,
    next_review_due_at         timestamptz,
    schedule_review_note       text,
    created_by                 bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    updated_by                 bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at                 timestamptz  NOT NULL DEFAULT now(),
    updated_at                 timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT activities_public_id_key UNIQUE (public_id),
    CONSTRAINT activities_name_chk
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT activities_short_description_chk
        CHECK (short_description IS NULL OR char_length(short_description) <= 1000),
    CONSTRAINT activities_season_mode_chk
        CHECK (season_mode = ANY (ARRAY[
            'all_year'::text,
            'best_months'::text,
            'poor_months'::text,
            'temporarily_unavailable'::text
        ])),
    CONSTRAINT activities_season_start_month_chk
        CHECK (season_start_month IS NULL OR (season_start_month BETWEEN 1 AND 12)),
    CONSTRAINT activities_season_end_month_chk
        CHECK (season_end_month IS NULL OR (season_end_month BETWEEN 1 AND 12)),
    CONSTRAINT activities_season_months_consistency_chk
        CHECK (
            (season_mode = ANY (ARRAY['all_year'::text, 'temporarily_unavailable'::text]))
            OR (season_start_month IS NOT NULL AND season_end_month IS NOT NULL)
            OR (season_start_month IS NULL AND season_end_month IS NULL)
        ),
    CONSTRAINT activities_schedule_review_note_chk
        CHECK (schedule_review_note IS NULL OR char_length(btrim(schedule_review_note)) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS activities_admin_area_id_idx
    ON tourism.activities (admin_area_id);

CREATE INDEX IF NOT EXISTS activities_activity_type_id_idx
    ON tourism.activities (activity_type_id);

CREATE INDEX IF NOT EXISTS activities_active_verified_listing_idx
    ON tourism.activities (is_active, is_verified, display_priority DESC, id)
    WHERE is_active IS TRUE;

CREATE TRIGGER activities_set_updated_at
    BEFORE UPDATE ON tourism.activities
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

COMMENT ON TABLE tourism.activities IS
    'Curated tourism activities. Schedule review fields only; no ranking/booking scores.';

-- ----------------------------------------------------------------------------
-- D. tourism.events (dates live on occurrences, not here)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tourism.events (
    id                         bigserial PRIMARY KEY,
    public_id                  uuid         NOT NULL DEFAULT gen_random_uuid(),
    name                       text         NOT NULL,
    short_description          text,
    event_type_id              bigint       NOT NULL
        REFERENCES ref.ref_event_types (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    primary_place_id           bigint
        REFERENCES core.core_places (id) ON DELETE SET NULL ON UPDATE CASCADE,
    admin_area_id              bigint       NOT NULL
        REFERENCES core.core_admin_areas (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    is_active                  boolean      NOT NULL DEFAULT true,
    is_verified                boolean      NOT NULL DEFAULT false,
    requires_schedule_review   boolean      NOT NULL DEFAULT false,
    last_schedule_reviewed_at  timestamptz,
    next_review_due_at         timestamptz,
    schedule_review_note       text,
    created_by                 bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    updated_by                 bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at                 timestamptz  NOT NULL DEFAULT now(),
    updated_at                 timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT events_public_id_key UNIQUE (public_id),
    CONSTRAINT events_name_chk
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT events_short_description_chk
        CHECK (short_description IS NULL OR char_length(short_description) <= 1000),
    CONSTRAINT events_schedule_review_note_chk
        CHECK (schedule_review_note IS NULL OR char_length(btrim(schedule_review_note)) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS events_admin_area_id_idx
    ON tourism.events (admin_area_id);

CREATE INDEX IF NOT EXISTS events_event_type_id_idx
    ON tourism.events (event_type_id);

CREATE INDEX IF NOT EXISTS events_active_verified_listing_idx
    ON tourism.events (is_active, is_verified, id)
    WHERE is_active IS TRUE;

CREATE TRIGGER events_set_updated_at
    BEFORE UPDATE ON tourism.events
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

COMMENT ON TABLE tourism.events IS
    'Curated tourism events/festivals. Occurrence dates are in tourism.event_occurrences only.';

-- ----------------------------------------------------------------------------
-- E. tourism.event_occurrences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tourism.event_occurrences (
    id              bigserial PRIMARY KEY,
    public_id       uuid         NOT NULL DEFAULT gen_random_uuid(),
    event_id        bigint       NOT NULL
        REFERENCES tourism.events (id) ON DELETE CASCADE ON UPDATE CASCADE,
    starts_at       timestamptz  NOT NULL,
    ends_at         timestamptz  NOT NULL,
    status          text         NOT NULL DEFAULT 'scheduled',
    schedule_note   text,
    source_url      text,
    verified_at     timestamptz,
    created_by      bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    updated_by      bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT event_occurrences_public_id_key UNIQUE (public_id),
    CONSTRAINT event_occurrences_time_range_chk
        CHECK (ends_at > starts_at),
    CONSTRAINT event_occurrences_status_chk
        CHECK (status = ANY (ARRAY[
            'scheduled'::text,
            'confirmed'::text,
            'cancelled'::text,
            'completed'::text
        ])),
    CONSTRAINT event_occurrences_schedule_note_chk
        CHECK (schedule_note IS NULL OR char_length(btrim(schedule_note)) BETWEEN 1 AND 1000),
    CONSTRAINT event_occurrences_source_url_chk
        CHECK (source_url IS NULL OR char_length(btrim(source_url)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS event_occurrences_event_id_idx
    ON tourism.event_occurrences (event_id);

CREATE INDEX IF NOT EXISTS event_occurrences_starts_at_idx
    ON tourism.event_occurrences (starts_at);

CREATE INDEX IF NOT EXISTS event_occurrences_ends_at_idx
    ON tourism.event_occurrences (ends_at);

CREATE INDEX IF NOT EXISTS event_occurrences_status_idx
    ON tourism.event_occurrences (status);

CREATE TRIGGER event_occurrences_set_updated_at
    BEFORE UPDATE ON tourism.event_occurrences
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

COMMENT ON TABLE tourism.event_occurrences IS
    'Concrete dated occurrences for tourism.events. Yearly recurrence is not stored on events.';

-- ----------------------------------------------------------------------------
-- G. RLS / privilege lock (API-only; match existing tourism model)
-- ----------------------------------------------------------------------------
ALTER TABLE tourism.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.event_occurrences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tourism FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE ref.ref_activity_types FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE ref.ref_event_types FROM PUBLIC, anon, authenticated;

COMMIT;
