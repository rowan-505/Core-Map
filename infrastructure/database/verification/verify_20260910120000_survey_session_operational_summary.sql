-- Verification for 20260910120000_survey_session_operational_summary.sql

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'survey_sessions'
          AND column_name = 'completion_status'
    ) THEN
        RAISE EXCEPTION 'feedback.survey_sessions.completion_status missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'survey_sessions'
          AND column_name = 'tracking_state'
    ) THEN
        RAISE EXCEPTION 'feedback.survey_sessions.tracking_state missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'feedback'
          AND table_name = 'survey_session_events'
    ) THEN
        RAISE EXCEPTION 'feedback.survey_session_events missing';
    END IF;
END $$;
