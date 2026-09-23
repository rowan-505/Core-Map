DROP TRIGGER IF EXISTS name_pair_reviews_set_updated_at ON ops.name_pair_reviews;
DROP FUNCTION IF EXISTS ops.set_updated_at();
DROP TABLE IF EXISTS ops.name_pair_fill_runs;
DROP TABLE IF EXISTS ops.name_pair_reviews;
