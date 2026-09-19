-- Verification for 20260917060000_place_activity_daily
SELECT
    EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'app'
          AND table_name = 'place_activity_daily'
    ) AS table_exists,
    (
        SELECT COUNT(*)::int
        FROM information_schema.columns
        WHERE table_schema = 'app'
          AND table_name = 'place_activity_daily'
          AND column_name IN (
              'place_id',
              'activity_date',
              'view_count',
              'save_count',
              'share_count',
              'directions_count',
              'updated_at'
          )
    ) AS expected_columns,
    EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'app.place_activity_daily'::regclass
          AND contype = 'p'
    ) AS has_pk,
    EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'app.place_activity_daily'::regclass
          AND contype = 'f'
          AND confrelid = 'core.core_places'::regclass
    ) AS has_place_fk;
