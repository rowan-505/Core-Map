-- Verify feedback.survey_variant_assignments exists with required constraints.

DO $$
BEGIN
    IF to_regclass('feedback.survey_variant_assignments') IS NULL THEN
        RAISE EXCEPTION 'missing table feedback.survey_variant_assignments';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'feedback.survey_variant_assignments'::regclass
          AND conname = 'survey_variant_assignments_public_id_key'
    ) THEN
        RAISE EXCEPTION 'missing unique public_id on survey_variant_assignments';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'feedback'
          AND indexname = 'survey_variant_assignments_active_user_variant_key'
    ) THEN
        RAISE EXCEPTION 'missing active (surveyor, variant) unique index';
    END IF;
END $$;
