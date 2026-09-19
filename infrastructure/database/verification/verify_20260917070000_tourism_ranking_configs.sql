-- Verification for 20260917070000_tourism_ranking_configs
SELECT
    EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'tourism' AND table_name = 'ranking_configs'
    ) AS table_exists,
    (
        SELECT COUNT(*)::int
        FROM tourism.ranking_configs
        WHERE is_active IS TRUE
          AND algorithm_version = 'coremap-tourism-ranking-v1'
    ) AS active_v1_rows,
    (
        SELECT COUNT(*)::int
        FROM tourism.ranking_configs
        WHERE is_active IS TRUE
          AND abs(
              (editorial_weight + importance_weight + review_weight + popularity_weight) - 1
          ) < 0.0001
    ) AS active_rows_weights_sum_ok;
