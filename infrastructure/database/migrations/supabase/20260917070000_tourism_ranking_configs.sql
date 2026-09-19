-- =============================================================================
-- 20260917070000_tourism_ranking_configs.sql
-- -----------------------------------------------------------------------------
-- Phase 4: Tourism Ranking V1 config rows (weights by geographic scope).
-- Does NOT store ranking results, history, or caches.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS tourism.ranking_configs (
    id                  bigserial PRIMARY KEY,
    scope_type          text        NOT NULL,
    algorithm_version   text        NOT NULL,
    editorial_weight    numeric(6,4) NOT NULL,
    importance_weight   numeric(6,4) NOT NULL,
    review_weight       numeric(6,4) NOT NULL,
    popularity_weight   numeric(6,4) NOT NULL,
    effective_from      timestamptz NOT NULL DEFAULT now(),
    is_active           boolean     NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ranking_configs_scope_type_chk
        CHECK (scope_type = ANY (ARRAY['township'::text, 'region'::text, 'national'::text])),
    CONSTRAINT ranking_configs_algorithm_version_chk
        CHECK (char_length(btrim(algorithm_version)) BETWEEN 1 AND 64),
    CONSTRAINT ranking_configs_weights_nonneg_chk
        CHECK (
            editorial_weight >= 0
            AND importance_weight >= 0
            AND review_weight >= 0
            AND popularity_weight >= 0
        ),
    CONSTRAINT ranking_configs_weights_sum_chk
        CHECK (
            abs(
                (editorial_weight + importance_weight + review_weight + popularity_weight) - 1
            ) < 0.0001
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS ranking_configs_active_scope_uidx
    ON tourism.ranking_configs (scope_type)
    WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS ranking_configs_version_idx
    ON tourism.ranking_configs (algorithm_version, scope_type);

COMMENT ON TABLE tourism.ranking_configs IS
    'Active weight sets for CoreMap Tourism Ranking V1 by geographic scope. Ranking scores are computed at query time.';

INSERT INTO tourism.ranking_configs (
    scope_type,
    algorithm_version,
    editorial_weight,
    importance_weight,
    review_weight,
    popularity_weight,
    effective_from,
    is_active
)
VALUES
    ('township', 'coremap-tourism-ranking-v1', 0.50, 0.25, 0.15, 0.10, now(), true),
    ('region',   'coremap-tourism-ranking-v1', 0.40, 0.30, 0.15, 0.15, now(), true),
    ('national', 'coremap-tourism-ranking-v1', 0.30, 0.40, 0.15, 0.15, now(), true)
ON CONFLICT DO NOTHING;

-- Re-seed if unique active index blocked a re-run with empty conflict target:
-- ensure exactly the V1 active rows exist.
INSERT INTO tourism.ranking_configs (
    scope_type, algorithm_version, editorial_weight, importance_weight,
    review_weight, popularity_weight, effective_from, is_active
)
SELECT v.scope_type, v.algorithm_version, v.editorial_weight, v.importance_weight,
       v.review_weight, v.popularity_weight, now(), true
FROM (
    VALUES
        ('township'::text, 'coremap-tourism-ranking-v1'::text, 0.50::numeric, 0.25::numeric, 0.15::numeric, 0.10::numeric),
        ('region', 'coremap-tourism-ranking-v1', 0.40, 0.30, 0.15, 0.15),
        ('national', 'coremap-tourism-ranking-v1', 0.30, 0.40, 0.15, 0.15)
) AS v(scope_type, algorithm_version, editorial_weight, importance_weight, review_weight, popularity_weight)
WHERE NOT EXISTS (
    SELECT 1
    FROM tourism.ranking_configs AS c
    WHERE c.scope_type = v.scope_type
      AND c.is_active IS TRUE
);

COMMIT;
