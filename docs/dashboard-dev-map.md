# Dashboard Dev Map

Internal map inspector at `/dashboard/dev-map`.

**Purpose:** show → filter → select → inspect → quick-action → navigate.  
**Not** a second full CRUD app. Full edits stay on Core Review, Transport, and Local Basemap pages.

Code: `apps/dashboard/src/features/dev-map/`.

---

## Architecture

```text
Public overview PMTiles + regional PMTiles (same as apps/web)
        +
Filter bar (entity visibility)
        +
Optional LIVE lifecycle MVT (Buildings/Land via API)
Optional Martin dynamic overlays (Places / Transport)
        +
Click or search → DevMapSelection → highlight → inspector
        +
Lifecycle actions → existing /local-basemap APIs (no new rules)
Open Details → existing dashboard routes
```

Rules:

- PostgreSQL stays on the API. The browser never connects to Postgres.
- Important data is not stored only in tiles.
- Dev Map does not mutate production PMTiles packages.
- Promote / Demote / Delete reuse `runLocalBasemapAction` only.

---

## Entity registry

Canonical list: `devMapEntityRegistry.ts`.

| Field | Role |
|-------|------|
| `supported` | Can toggle / select on map |
| `unsupportedReason` | Shown in UI (`n/a`) when false |
| `sourceKind` | `pmtiles` \| `dynamic` \| `lifecycle-mvt` (registry primary kind) |
| `baseLayerIds` | MapLibre layer ids (regional clones use `id-{region}`) |
| `stableIdProperty` | Identity for detail lookup |
| `selectionPriority` | Lower wins on overlapping click |
| `minSelectableZoom` | Click ignored below this zoom |
| `detailRoute` / `detailApi` | Open Details + inspector fetch |

Unsupported entities stay in the filter bar as disabled checkboxes. They do not silently fail.

### Selection priority (lower = preferred)

Places (3) → Transport stops (4) → lifecycle Buildings (5) → lifecycle Land (8) → static Buildings (10) → Streets (25) → Settlements (30) → Transport routes (32) → static Land (40) → Admin (50) → Water (60) → Protected (70).

---

## Static vs dynamic vs lifecycle

| Kind | When used | Delivery |
|------|-----------|----------|
| **Static PMTiles** | Streets, Admin, Water, basemap Buildings/Land | Overview + regional packages (`createDevMapBasemap`, public `base-map.json`) |
| **Lifecycle MVT** | Live Base / Core / Archive for Buildings & Land | `GET /local-basemap/tiles/{buildings\|land}_lifecycle/{z}/{x}/{y}` |
| **Dynamic Martin** | Places, Transport stops/routes | Existing Martin source ids; created only when enabled |

Buildings/Land intentionally have both PMTiles paint and a lifecycle overlay when the checkbox is on. Lifecycle wins on click.

Overlays are **lazy**: sources are created when the entity is enabled and **removed** when disabled (no full style reload).

---

## How to add a new entity type

1. Add a row to `DEV_MAP_ENTITY_REGISTRY` with real `baseLayerIds` (or `supported: false` + reason).
2. If map layers exist: ensure public style / Martin source already provides them — do not invent a parallel basemap.
3. Add an inspector adapter in `devMapInspectorAdapters.ts` that calls an **existing** detail API.
4. Wire click identity in `devMapClickSelect` / registry `stableIdProperty` only if needed.
5. Prefer Open Details navigation over new in-map edit forms.
6. Add/adjust unit tests under `src/features/dev-map/*.test.ts`.

Do not add Redis, workers, or browser-side giant caches for Dev Map.

---

## How actions are reused

Building / Land lifecycle:

| State | Actions |
|-------|---------|
| Base, Archive | Promote → Core |
| Core | Demote → Local; Delete (suppress) |
| Deleted | Clear suppression |

Implementation:

- UI matrix: `actionsForLifecycleState` / API `available_actions`
- Execute: `runDevMapLifecycleAction` → `runLocalBasemapAction`
- Delete confirm copy matches Local Basemap (`DEV_MAP_DELETE_CONFIRM`)
- After success: refresh lifecycle MVT via `setTiles` (camera unchanged)

Other entities: Open Details / Edit links only (no duplicate CRUD).

Regression: `devMapInspectorActions.test.ts` (`DEV_MAP_LIFECYCLE_ACTION_MATRIX`).

---

## How to run locally

1. API + dashboard running; dashboard auth as usual.
2. Enable UI (non-production):
   - `NEXT_PUBLIC_ENABLE_LOCAL_BASEMAP_ADMIN=true`, or
   - `NEXT_PUBLIC_ENABLE_DEV_MAP=true` on localhost.
3. For lifecycle MVT overlays: API `ENABLE_LOCAL_BASEMAP_ADMIN` + `LOCAL_TILE_DATABASE_URL` (local tiles DB).
4. Open `/dashboard/dev-map`.

Measure lifecycle tile cost (API, tiles DB up):

```bash
cd apps/api && npx tsx src/modules/local-basemap/measure-lifecycle-mvt.ts
```

Dev Map tests:

```bash
cd apps/dashboard && node --import tsx --test src/features/dev-map/*.test.ts
```

---

## Performance rules

1. No all-buildings / all-land GeoJSON dumps.
2. No browser PostgreSQL.
3. Do not duplicate static PMTiles sources; region loader is idempotent.
4. Lifecycle MVT only while Buildings/Land are enabled; remove source when off.
5. Dynamic Martin overlays only while Places/Transport are enabled.
6. Full inspector detail loads only after select (click or search).
7. Checkbox toggle uses `setLayoutProperty` / lazy add-remove — never remount the map or reload the whole style.
8. Click queries only enabled, zoom-eligible, visible layers.
9. Debounce + abort search; abort stale inspector and search-resolve requests.
10. Lifecycle MVT: Core+Archive only (Base on PMTiles). Buildings z≥15, Land z≥14. 3s tile timeout + separate admin DB pool so feature detail is not blocked. Sources unmount when zoomed out.

---

## Safety

- Production builds: Dev Map UI off (`isDevMapUiEnabled`).
- Lifecycle tile + mutate routes: local-basemap admin gate + dashboard auth/write.
- No tile DB credentials in the frontend.
- Dev Map does not publish or rewrite CDN PMTiles.
