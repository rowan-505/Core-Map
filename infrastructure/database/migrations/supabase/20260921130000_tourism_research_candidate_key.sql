-- tourism.research_candidates: stable candidate_key for idempotent research imports
-- Phase 5 staging only — does not create production tourism entities.

ALTER TABLE tourism.research_candidates
    ADD COLUMN IF NOT EXISTS candidate_key text;

ALTER TABLE tourism.research_candidates
    DROP CONSTRAINT IF EXISTS research_candidates_candidate_key_chk;

ALTER TABLE tourism.research_candidates
    ADD CONSTRAINT research_candidates_candidate_key_chk
    CHECK (
        candidate_key IS NULL
        OR char_length(btrim(candidate_key)) BETWEEN 1 AND 200
    );

-- Idempotency: one staging row per research run + stable candidate key
CREATE UNIQUE INDEX IF NOT EXISTS research_candidates_run_candidate_key_uidx
    ON tourism.research_candidates (research_run_id, candidate_key)
    WHERE research_run_id IS NOT NULL
      AND candidate_key IS NOT NULL;

COMMENT ON COLUMN tourism.research_candidates.candidate_key IS
    'Stable normalized candidate identity within a research_run_id. Used for idempotent import.';
