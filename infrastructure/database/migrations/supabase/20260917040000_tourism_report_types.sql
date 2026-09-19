-- Seed tourism report types into the existing feedback reporting contract.
-- Reuses feedback.user_reports + ref.ref_report_types (no new reporting tables).
-- Does not touch tourism.place_reviews or tourism.place_rating_summaries.
-- Closed / duplicate tourism issues continue to use closed_or_removed / duplicate_item.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

INSERT INTO ref.ref_report_types (code, name)
VALUES
    ('tourism_incorrect_type', 'Incorrect tourism type'),
    ('tourism_incorrect_description', 'Incorrect tourism description'),
    ('tourism_incorrect_price', 'Incorrect tourism price level'),
    ('tourism_incorrect_review', 'Incorrect tourism rating or review'),
    ('tourism_other', 'Other tourism information')
ON CONFLICT (code) DO NOTHING;

COMMIT;
