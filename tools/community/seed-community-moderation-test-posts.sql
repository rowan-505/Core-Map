-- Minimal disposable Community post seeds for dashboard moderation tabs.
-- Tag: titles start with [SEED] so they are easy to find and delete.
-- Author: app_auth.auth_users.id = 25 (rowan.nyihtet@gmail.com)
-- Location: Kyauktan-ish point (lon/lat WGS84).
--
-- Cleanup later:
--   DELETE FROM community.community_posts WHERE title LIKE '[SEED]%';

WITH author AS (
    SELECT id AS author_id
    FROM app_auth.auth_users
    WHERE id = 25
),
seed(title, description, topic, publication_status, verification_status, trust_score, deleted) AS (
    VALUES
        (
            '[SEED] Free board — Review Queue',
            'Minimal free-board post for Review Queue (published + unverified).',
            'local_update',
            'published',
            'unverified',
            0,
            false
        ),
        (
            '[SEED] Trusted — community confirmed',
            'Minimal trusted post via community confirmation.',
            'transport',
            'published',
            'community_confirmed',
            8,
            false
        ),
        (
            '[SEED] Trusted — CoreMap verified',
            'Minimal trusted post via admin verification.',
            'safety',
            'published',
            'admin_verified',
            0,
            false
        ),
        (
            '[SEED] Resolved post',
            'Minimal resolved post for Resolved tab.',
            'public_service',
            'resolved',
            'unverified',
            0,
            false
        ),
        (
            '[SEED] Rejected post',
            'Minimal rejected post for Rejected tab.',
            'other',
            'rejected',
            'unverified',
            0,
            false
        ),
        (
            '[SEED] Expired post',
            'Minimal expired post for Expired tab.',
            'event',
            'expired',
            'unverified',
            0,
            false
        ),
        (
            '[SEED] Removed post',
            'Minimal removed/soft-deleted post (not shown in main tabs).',
            'business',
            'removed',
            'unverified',
            0,
            true
        )
)
INSERT INTO community.community_posts (
    author_id,
    title,
    description,
    topic,
    publication_status,
    verification_status,
    trust_score,
    location,
    location_label,
    published_at,
    deleted_at
)
SELECT
    author.author_id,
    seed.title,
    seed.description,
    seed.topic,
    seed.publication_status::community.publication_status,
    seed.verification_status::community.verification_status,
    seed.trust_score,
    ST_SetSRID(ST_MakePoint(96.5205, 16.6688), 4326),
    'Kyauktan (seed)',
    now(),
    CASE WHEN seed.deleted THEN now() ELSE NULL END
FROM seed
CROSS JOIN author
WHERE NOT EXISTS (
    SELECT 1
    FROM community.community_posts p
    WHERE p.title = seed.title
)
RETURNING public_id, title, publication_status, verification_status;
