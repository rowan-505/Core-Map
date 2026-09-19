-- Verify Phase 2 tourism taxonomy + ranking inputs.

SELECT COUNT(*)::int AS tourism_type_count FROM ref.ref_tourism_types WHERE is_active;
SELECT code FROM ref.ref_tourism_types ORDER BY sort_order, id;

SELECT
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='tourism' AND table_name='place_profiles' AND column_name='tourism_type_id'
    ) AS has_tourism_type_id,
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='tourism' AND table_name='place_profiles' AND column_name='tourism_type'
    ) AS has_legacy_tourism_type_text,
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='tourism' AND table_name='place_profiles' AND column_name='editorial_score'
    ) AS has_editorial_score;

SELECT conname FROM pg_constraint
WHERE conrelid = 'tourism.place_profiles'::regclass
  AND conname LIKE 'place_profiles_%'
ORDER BY 1;
