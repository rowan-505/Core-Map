-- Rollback: tourism.research_candidates.candidate_key

DROP INDEX IF EXISTS tourism.research_candidates_run_candidate_key_uidx;

ALTER TABLE tourism.research_candidates
    DROP CONSTRAINT IF EXISTS research_candidates_candidate_key_chk;

ALTER TABLE tourism.research_candidates
    DROP COLUMN IF EXISTS candidate_key;
