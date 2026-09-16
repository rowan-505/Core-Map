-- Verification for 20260910130000_survey_variant_completions.sql

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'feedback'
          AND table_name = 'survey_variant_completions'
    ) THEN
        RAISE EXCEPTION 'feedback.survey_variant_completions missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'survey_variant_completions_user_variant_key'
    ) THEN
        RAISE EXCEPTION 'survey_variant_completions unique (created_by, route_variant_id) missing';
    END IF;
END $$;
