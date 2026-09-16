# Roadmap

Canonical product rules and V2 order live in [`AGENTS.md`](../AGENTS.md). This page is the short human summary.

## V1 baseline

Public web map, MapLibre + PMTiles, POI markers, Myanmar labels, dashboard core/import review, core DB entities.

## V2 goals

- National PMTiles (overview + regions)
- Yangon / Kyauktan precision tiers
- Auth, saved places, reports, manual admin points
- Unified search + address / reverse
- Whole-country Valhalla routing
- YBS + express route viewing
- Safe, time-limited live location sharing
- Dashboard control for data, tiles, routing, users, health

## Default build order

1. Security foundation  
2. National PMTiles + package registry  
3. Auth + saved places  
4. Contributions + manual points  
5. Unified search  
6. Address system  
7. Valhalla routing  
8. YBS + express  
9. Live location  

## Out of V2 (unless asked)

Automatic points, fake live bus GPS, flights, social feeds, LLM-as-core-search, nationwide manual precision, production native mobile, offline downloads.

## Current production auth

- Email / password
- OTP / password recovery
- Google OAuth
- Session / device management
- Admin MFA
- Secure Google account linking (Account → Security)

## Facebook OAuth — deferred to later release

Reason:

- Technical integration already exists in the API/web/dashboard.
- Meta public production publishing currently requires additional verification/review.
- CoreMap is not enabling Facebook for the current release (`FACEBOOK_OAUTH_ENABLED=false`).

Later activation checklist:

1. Complete valid Meta verification path
2. Complete Meta App Review
3. Publish Meta app
4. Rotate/create production Meta App Secret
5. Configure production `FACEBOOK_OAUTH_APP_ID`
6. Configure production `FACEBOOK_OAUTH_APP_SECRET`
7. Configure redirect URI: `https://api.coremapmm.com/auth/oauth/facebook/callback`
8. Test Facebook user with email
9. Test Facebook user without email (`/auth/complete-profile`)
10. Test same-email `link_required` flow
11. Test Account → Security linking
12. Test with a normal non-developer Facebook account
13. Set `FACEBOOK_OAUTH_ENABLED=true`
