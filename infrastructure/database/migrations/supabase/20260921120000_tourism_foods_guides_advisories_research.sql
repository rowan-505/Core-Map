-- =============================================================================
-- 20260921120000_tourism_foods_guides_advisories_research.sql
-- -----------------------------------------------------------------------------
-- Phase 1: Tourism foods, food↔place links, local guides, advisories,
-- and unverified research_candidates staging.
--
-- Preserves existing tourism tables. No ranking/score columns on foods.
-- Access: API-only (RLS on, no anon/authenticated policies; schema revoked).
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- ----------------------------------------------------------------------------
-- A. tourism.foods
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tourism.foods (
    id                 bigserial PRIMARY KEY,
    public_id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    name               text         NOT NULL,
    name_en            text,
    name_mm            text,
    short_description  text,
    food_type          text         NOT NULL,
    labels             text[]       NOT NULL DEFAULT '{}'::text[],
    admin_area_id      bigint       NOT NULL
        REFERENCES core.core_admin_areas (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    is_active          boolean      NOT NULL DEFAULT true,
    is_verified        boolean      NOT NULL DEFAULT false,
    source_url         text,
    verified_at        timestamptz,
    created_by         bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    updated_by         bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT foods_public_id_key UNIQUE (public_id),
    CONSTRAINT foods_name_chk
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT foods_name_en_chk
        CHECK (name_en IS NULL OR char_length(btrim(name_en)) BETWEEN 1 AND 200),
    CONSTRAINT foods_name_mm_chk
        CHECK (name_mm IS NULL OR char_length(btrim(name_mm)) BETWEEN 1 AND 200),
    CONSTRAINT foods_short_description_chk
        CHECK (short_description IS NULL OR char_length(short_description) <= 1000),
    CONSTRAINT foods_food_type_chk
        CHECK (food_type = ANY (ARRAY[
            'dish'::text,
            'snack'::text,
            'dessert'::text,
            'drink'::text,
            'specialty'::text,
            'other'::text
        ])),
    CONSTRAINT foods_labels_allowed_chk
        CHECK (labels <@ ARRAY[
            'signature'::text,
            'must_try'::text,
            'popular'::text,
            'traditional'::text,
            'local_specialty'::text,
            'street_food'::text,
            'seasonal'::text
        ]),
    CONSTRAINT foods_source_url_chk
        CHECK (source_url IS NULL OR char_length(btrim(source_url)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS foods_admin_area_id_idx
    ON tourism.foods (admin_area_id);

CREATE TRIGGER foods_set_updated_at
    BEFORE UPDATE ON tourism.foods
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

COMMENT ON TABLE tourism.foods IS
    'Curated tourism foods/dishes (not restaurants). List-based V1; no rank/score columns.';

-- ----------------------------------------------------------------------------
-- B. tourism.food_place_links
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tourism.food_place_links (
    id                 bigserial PRIMARY KEY,
    food_id            bigint       NOT NULL
        REFERENCES tourism.foods (id) ON DELETE CASCADE ON UPDATE CASCADE,
    place_id           bigint       NOT NULL
        REFERENCES core.core_places (id) ON DELETE CASCADE ON UPDATE CASCADE,
    availability_note  text,
    is_signature_here  boolean      NOT NULL DEFAULT false,
    is_verified        boolean      NOT NULL DEFAULT false,
    source_url         text,
    verified_at        timestamptz,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT food_place_links_food_place_key UNIQUE (food_id, place_id),
    CONSTRAINT food_place_links_availability_note_chk
        CHECK (availability_note IS NULL OR char_length(btrim(availability_note)) BETWEEN 1 AND 1000),
    CONSTRAINT food_place_links_source_url_chk
        CHECK (source_url IS NULL OR char_length(btrim(source_url)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS food_place_links_food_id_idx
    ON tourism.food_place_links (food_id);

CREATE INDEX IF NOT EXISTS food_place_links_place_id_idx
    ON tourism.food_place_links (place_id);

CREATE TRIGGER food_place_links_set_updated_at
    BEFORE UPDATE ON tourism.food_place_links
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

COMMENT ON TABLE tourism.food_place_links IS
    'Links a tourism food to a core.core_places venue where it can be tried. One row per food/place pair.';

-- ----------------------------------------------------------------------------
-- C. tourism.local_guides
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tourism.local_guides (
    id                 bigserial PRIMARY KEY,
    public_id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    admin_area_id      bigint       NOT NULL
        REFERENCES core.core_admin_areas (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    place_id           bigint
        REFERENCES core.core_places (id) ON DELETE SET NULL ON UPDATE CASCADE,
    guide_type         text         NOT NULL,
    title              text         NOT NULL,
    short_description  text,
    content            text         NOT NULL,
    is_active          boolean      NOT NULL DEFAULT true,
    is_verified        boolean      NOT NULL DEFAULT false,
    source_url         text,
    verified_at        timestamptz,
    created_by         bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    updated_by         bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT local_guides_public_id_key UNIQUE (public_id),
    CONSTRAINT local_guides_guide_type_chk
        CHECK (guide_type = ANY (ARRAY[
            'culture'::text,
            'craft'::text,
            'local_product'::text,
            'food_culture'::text,
            'etiquette'::text,
            'visitor_tip'::text,
            'practical_info'::text,
            'other'::text
        ])),
    CONSTRAINT local_guides_title_chk
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT local_guides_short_description_chk
        CHECK (short_description IS NULL OR char_length(short_description) <= 1000),
    CONSTRAINT local_guides_content_chk
        CHECK (char_length(btrim(content)) BETWEEN 1 AND 20000),
    CONSTRAINT local_guides_source_url_chk
        CHECK (source_url IS NULL OR char_length(btrim(source_url)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS local_guides_admin_area_id_idx
    ON tourism.local_guides (admin_area_id);

CREATE INDEX IF NOT EXISTS local_guides_place_id_idx
    ON tourism.local_guides (place_id)
    WHERE place_id IS NOT NULL;

CREATE TRIGGER local_guides_set_updated_at
    BEFORE UPDATE ON tourism.local_guides
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

COMMENT ON TABLE tourism.local_guides IS
    'Stable visitor guide content scoped to an admin area; optional place_id when place-specific.';

-- ----------------------------------------------------------------------------
-- D. tourism.advisories
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tourism.advisories (
    id                 bigserial PRIMARY KEY,
    public_id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    admin_area_id      bigint       NOT NULL
        REFERENCES core.core_admin_areas (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    place_id           bigint
        REFERENCES core.core_places (id) ON DELETE SET NULL ON UPDATE CASCADE,
    activity_id        bigint
        REFERENCES tourism.activities (id) ON DELETE SET NULL ON UPDATE CASCADE,
    event_id           bigint
        REFERENCES tourism.events (id) ON DELETE SET NULL ON UPDATE CASCADE,
    advisory_type      text         NOT NULL,
    title              text         NOT NULL,
    description        text         NOT NULL,
    severity           text         NOT NULL,
    effective_from     timestamptz,
    effective_until    timestamptz,
    is_active          boolean      NOT NULL DEFAULT true,
    is_verified        boolean      NOT NULL DEFAULT false,
    source_url         text,
    verified_at        timestamptz,
    created_by         bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    updated_by         bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT advisories_public_id_key UNIQUE (public_id),
    CONSTRAINT advisories_advisory_type_chk
        CHECK (advisory_type = ANY (ARRAY[
            'access'::text,
            'seasonal'::text,
            'closure'::text,
            'safety'::text,
            'etiquette'::text,
            'transport'::text,
            'weather'::text,
            'payment'::text,
            'visitor_requirement'::text,
            'other'::text
        ])),
    CONSTRAINT advisories_severity_chk
        CHECK (severity = ANY (ARRAY[
            'info'::text,
            'caution'::text,
            'important'::text
        ])),
    CONSTRAINT advisories_title_chk
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT advisories_description_chk
        CHECK (char_length(btrim(description)) BETWEEN 1 AND 5000),
    CONSTRAINT advisories_effective_range_chk
        CHECK (
            effective_from IS NULL
            OR effective_until IS NULL
            OR effective_until >= effective_from
        ),
    CONSTRAINT advisories_source_url_chk
        CHECK (source_url IS NULL OR char_length(btrim(source_url)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS advisories_admin_area_id_idx
    ON tourism.advisories (admin_area_id);

CREATE INDEX IF NOT EXISTS advisories_place_id_idx
    ON tourism.advisories (place_id)
    WHERE place_id IS NOT NULL;

CREATE TRIGGER advisories_set_updated_at
    BEFORE UPDATE ON tourism.advisories
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

COMMENT ON TABLE tourism.advisories IS
    'Time-sensitive visitor advisories. Historical-only changes belong in canonical entity updates, not here.';

-- ----------------------------------------------------------------------------
-- E. tourism.research_candidates (unverified staging — not public production data)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tourism.research_candidates (
    id                       bigserial PRIMARY KEY,
    public_id                uuid         NOT NULL DEFAULT gen_random_uuid(),
    admin_area_id            bigint       NOT NULL
        REFERENCES core.core_admin_areas (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    entity_type              text         NOT NULL,
    name                     text         NOT NULL,
    research_status          text         NOT NULL DEFAULT 'new',
    evidence_confidence      smallint,
    normalized_payload       jsonb        NOT NULL,
    research_provider        text         NOT NULL,
    research_run_id          text,
    researched_at            timestamptz  NOT NULL,
    reviewed_by              bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    reviewed_at              timestamptz,
    created_entity_type      text,
    created_entity_public_id uuid,
    created_at               timestamptz  NOT NULL DEFAULT now(),
    updated_at               timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT research_candidates_public_id_key UNIQUE (public_id),
    CONSTRAINT research_candidates_entity_type_chk
        CHECK (entity_type = ANY (ARRAY[
            'attraction'::text,
            'activity'::text,
            'event'::text,
            'food'::text,
            'food_place'::text,
            'local_guide'::text,
            'advisory'::text,
            'other'::text
        ])),
    CONSTRAINT research_candidates_research_status_chk
        CHECK (research_status = ANY (ARRAY[
            'new'::text,
            'reviewing'::text,
            'added'::text,
            'rejected'::text,
            'needs_research'::text
        ])),
    CONSTRAINT research_candidates_evidence_confidence_chk
        CHECK (
            evidence_confidence IS NULL
            OR (evidence_confidence BETWEEN 0 AND 100)
        ),
    CONSTRAINT research_candidates_name_chk
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT research_candidates_research_provider_chk
        CHECK (char_length(btrim(research_provider)) BETWEEN 1 AND 100),
    CONSTRAINT research_candidates_research_run_id_chk
        CHECK (research_run_id IS NULL OR char_length(btrim(research_run_id)) BETWEEN 1 AND 200),
    CONSTRAINT research_candidates_created_entity_type_chk
        CHECK (
            created_entity_type IS NULL
            OR created_entity_type = ANY (ARRAY[
                'attraction'::text,
                'activity'::text,
                'event'::text,
                'food'::text,
                'food_place'::text,
                'local_guide'::text,
                'advisory'::text,
                'other'::text
            ])
        ),
    CONSTRAINT research_candidates_created_entity_pair_chk
        CHECK (
            (created_entity_type IS NULL AND created_entity_public_id IS NULL)
            OR (created_entity_type IS NOT NULL AND created_entity_public_id IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS research_candidates_admin_area_status_idx
    ON tourism.research_candidates (admin_area_id, research_status);

CREATE INDEX IF NOT EXISTS research_candidates_entity_type_idx
    ON tourism.research_candidates (entity_type);

CREATE TRIGGER research_candidates_set_updated_at
    BEFORE UPDATE ON tourism.research_candidates
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

COMMENT ON TABLE tourism.research_candidates IS
    'Unverified AI/human research staging. Not public production tourism data until admin promotion.';

-- ----------------------------------------------------------------------------
-- F. RLS / privilege lock (API-only; match existing tourism model)
-- ----------------------------------------------------------------------------
ALTER TABLE tourism.foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.food_place_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.local_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.advisories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.research_candidates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tourism FROM PUBLIC, anon, authenticated;

COMMIT;
