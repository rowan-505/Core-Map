# Postal import summary (apply)

- Source: Myanmar Post V1.0 (September 2021)
- Production rows planned: **17297**
- Rejected malformed source rows: **2** (codes: ['114560'])
- `core.core_addresses.postal_code` was **not** overwritten.

## Match status counts

| Status | Count |
|---|---:|
| linked_township_only | 12298 |
| unmatched | 3361 |
| linked_local_area | 1638 |

## Report files

- `postal-linked.csv` — 1638 linked_local_area
- `postal-township-only.csv` — 12298 linked_township_only
- `postal-manual-review.csv` — 3361 ambiguous/unmatched
- `postal-rejected.csv` — 2 malformed_rejected (not in production table)

## Postconditions

| Check | Value | Pass |
|---|---|:---:|
| exactly 17297 planned | 17297 | yes |
| exactly 17297 in DB | 17297 | yes |
| zero duplicate planned | True | yes |
| zero duplicate DB | True | yes |
| zero invalid DB codes | True | yes |
| every row has match_status | True | yes |
| linked local reaches township | True | yes |
| FKs active | True | yes |

## Access

- Table is RLS-enabled with `REVOKE` from `anon`/`authenticated`.
- Access only through the Fastify API (`GET /postal-codes/:postalCode`).

