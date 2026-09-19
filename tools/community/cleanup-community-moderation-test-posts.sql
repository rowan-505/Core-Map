-- Cleanup for tools/community/seed-community-moderation-test-posts.sql
DELETE FROM community.community_posts
WHERE title LIKE '[SEED]%';
