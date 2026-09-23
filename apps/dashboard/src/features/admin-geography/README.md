# Admin geography

Dashboard browser for `core.core_admin_areas` at `/dashboard/admin-geography`.

## Modes

| Mode | URL | Behaviour |
|------|-----|-----------|
| Browse (default) | `/dashboard/admin-geography` | Read-only list / MVT map / detail. No geometry edit. |
| MIMU remediation | `/dashboard/admin-geography?mode=mimu-remediation` | Defaults to `geometry_source=mimu_placeholder` + non-public. Simple owned-conversion flow. |

## Simple remediation flow

1. **Edit geometry** — adjust the polygon and click Keep draft (or keep the current shape).
2. **Evidence (optional)** — add survey/report items if you have them.
3. **Apply as owned** — sets source to `coremap_manual` / `government` / `osm`, clears MIMU placeholder status.

Optional checkbox: mark boundary approximate. Rare path: Reject this area.

Placeholders stay **non-public**. Public search/tiles/CDN need a later explicit production approval.

## Production publication gate (unconditional)

The remediation API always keeps `is_public_usable=false` and rejects turning public on from this panel. Badges show `eligible: no` while gated.

## Evidence

Evidence is nullable JSONB `core.core_admin_areas.evidence`:

```json
{ "items": [{ "type", "value", "label", "note", "captured_at", "storage_path?", "sha256?" }] }
```

- Supporting proof only — do not duplicate origin into evidence.
- Origin stays in `source_refs` / `normalized_data`.
- `storage_path` is private metadata; never expose public file URLs.

## API decisions (internal)

`Apply as owned` sends `replace_source` (or `approximate` if checked). Reject sends `reject`.

Older values (`keep_database_only`, `needs_evidence`) may still exist on historical rows. Applied via `PATCH /admin-areas/:id/remediation`.

## Filters

Level / type / flags as before. In remediation mode also: Rejected, evidence item status.
