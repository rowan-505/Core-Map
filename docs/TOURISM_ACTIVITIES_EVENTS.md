# CoreMap Tourism Activities & Events

V1 catalog for curated township activities and festivals/events. Source of truth is PostgreSQL/PostGIS. Clients use the Fastify API only. Tiles do not store this data.

## Activities

Activities are independent tourism entities (not place profiles).

- Optional link to a CoreMap place (`primary_place_id`)
- Required township / admin area
- Activity type from `ref.ref_activity_types`
- Season mode: `all_year`, `best_months`, `poor_months`, `temporarily_unavailable`
- Curated ordering via `display_priority`
- Optional schedule-review track for seasonal / permit / temporary schedules
- No activity ranking or activity reviews in V1

## Events

Festivals are an event type (`festival` in `ref.ref_event_types`), not a separate table. There is no `tourism.festivals` table.

- Event identity lives on `tourism.events`
- Dates live on `tourism.event_occurrences`
- One event can have many yearly (or other) occurrences
- Short and long-running events use the same occurrence table
- Previous occurrences are preserved (soft history by keeping rows)

## Event Occurrences

Each occurrence has:

- `starts_at` / `ends_at` (`ends_at > starts_at`)
- `status`: `scheduled` | `confirmed` | `cancelled` | `completed`
- Optional `schedule_note` and `source_url`

Short festivals and multi-month events use the same shape. Create a new occurrence for each year or date range; do not overwrite history.

## Public States

Derived at query time from occurrence times and status (not stored):

| State | Meaning |
|-------|---------|
| `upcoming` | Starts in the future |
| `happening_now` | Ongoing window |
| `finished` | Ended |
| `cancelled` | Status cancelled |

## Long-running Events

Use `schedule_note` for human schedule text (for example “Open daily 10:00–18:00”). Do not invent a recurrence engine in V1.

## Schedule Review

Stored fields:

- `requires_schedule_review` — opt into the review track
- `last_schedule_reviewed_at` — set only by confirm action (`now()`)
- `next_review_due_at` — next due date (set only by confirm)
- `schedule_review_note` — admin note (set only by confirm)

Derived review states (never stored):

| State | Rule |
|-------|------|
| `none` | Review not required |
| `current` | Due more than 30 days out |
| `due_soon` | Due within the next 30 days |
| `overdue` | Due date passed, or required with null due date |

**Need Review** includes:

- `due_soon`
- `overdue`
- Events with **missing next occurrence** (review required, latest usable occurrence ended, no future `scheduled`/`confirmed` occurrence)

Confirm endpoint: `POST /admin/tourism/{activities\|events}/:id/schedule-review`.

## Admin Workflow

**Event**

1. Create event
2. Add occurrence
3. Confirm occurrence / verify
4. Publish (`is_active` / `is_verified`)
5. Later: Need Review
6. Verify next year’s dates (previous occurrence is reference only — no auto date copy)
7. Create next occurrence
8. Confirm schedule reviewed

**Activity**

1. Create activity
2. Configure season
3. Optionally enable annual review
4. Need Review when due
5. Update season / notes and confirm schedule reviewed

## Public Discover

Public read APIs:

- Recommended Attractions (existing tourism places ranking)
- Things to Do → `GET /tourism/activities`
- Happening Now → `GET /tourism/events?kind=happening_now`
- Upcoming Events → `GET /tourism/events?kind=upcoming`

Public payloads omit schedule-review fields, audit actors, and internal numeric IDs.

## Not V1

- activity reviews / event reviews
- activity ranking / event ranking
- booking / ticketing / organizers
- recurrence rule engine
- push / email reminders
- AI recommendations / personalization
