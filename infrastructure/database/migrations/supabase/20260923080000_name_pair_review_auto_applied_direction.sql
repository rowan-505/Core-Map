-- Allow re-queue of AI/auto transliteration fills for human review.

ALTER TABLE ops.name_pair_reviews
    DROP CONSTRAINT IF EXISTS name_pair_reviews_direction_chk;

ALTER TABLE ops.name_pair_reviews
    ADD CONSTRAINT name_pair_reviews_direction_chk
        CHECK (direction = ANY (ARRAY[
            'mm_to_en'::text,
            'en_to_mm'::text,
            'split_mixed'::text,
            'fix_false_pair'::text,
            'review_auto_applied'::text
        ]));

COMMENT ON CONSTRAINT name_pair_reviews_direction_chk ON ops.name_pair_reviews IS
    'Includes review_auto_applied for already-written transliteration pairs awaiting human check.';
