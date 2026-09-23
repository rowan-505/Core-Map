# Phase 1 existing-data cleanup — action manifest

Verified against live CoreMap identities (production project `locghyuranqaqsnbxflc`) before writing migration `20260921120000_admin_phase1_existing_data_cleanup.sql`.

Do **not** apply to production until after disposable/local validation.

## Identity resolution (seven townships)

| Label | CoreMap ID | Verified identity | Before parent | After parent |
|---|---:|---|---|---|
| Nan Yun / Nanyun | **6674** | `နန်းယွန်းမြို့နယ်` / Nanyun Township | 6665 Tanai Dist (Kachin) | **6693** Naga SAZ |
| Hsihseng | **6091** | `ဆီဆိုင်မြို့နယ်` (spatial↔MIMU). Not 6410 | 5999 Loikaw Dist (Kayah) | **6115** Pa-O SAZ |
| Pinlaung | **6073** | `ပင်လောင်းမြို့နယ်` | 6042 Zeyathiri (NPT) | **6115** Pa-O SAZ |
| Ywangan | **6187** | `ရွာငံမြို့နယ်` | 6197 Kyaukse (Mandalay) | **6192** Danu SAZ |
| Pyay | **7139** | `ပြည်မြို့နယ်` | 7128 Thayet (Magway) | **new Pyay District** under Bago 7169 |
| Padaung | **6778** | `ပန်းတောင်းမြို့နယ်` | 7155 Myanaung (Ayeyarwady) | **new Pyay District** |
| Shwedaung | **7151** | `ရွှေတောင်မြို့နယ်` | 7155 Myanaung (Ayeyarwady) | **new Pyay District** |

**Rejected ID:** Phase 1 `update_name` matched Hsihseng→**6410** (`ရှီးရှမ်း‌မြို့နယ်` under Kokang). Spatial evidence points to **6091**. Migration uses 6091 and demotes the wrong English primary on 6410.

## Self-administered hierarchy

| Area | CoreMap ID | Action |
|---|---:|---|
| Pa-O SAZ | 6115 | parent → Shan **6329**; members 6091, 6073, **6310** Hopong (point-in-SAZ) |
| Danu SAZ | 6192 | parent → Shan **6329**; members 6187, **6144** Pindaya (point-in-SAZ) |
| Naga SAZ | 6693 | parent → Sagaing **6703**; members 6674, **6692** Lahe, **6699** Leshi (point-in-SAZ) |
| Kokang SAZ | **6411** | reclassify district→`self_administered_zone` (rank 35), type SAZ; parent already Shan |
| Pa Laung SAZ | **new** | create at rank 35 under Shan; members **6394** Namhsan, **6527** Mantong |
| Wa SAD | **new** | create at rank 35, type `self_administered_division`, under Shan |

## Wa North / South

| ID | Name | Action |
|---:|---|---|
| 6378 | Wa South | remove from country first-level; parent→Wa SAD; type `special_area`; `search_only` |
| 6485 | Wa North | same |

Descendants under Wa trees: `address_usage=search_only` (or keep foreign rules for 5985/5986). No hard-delete. No official-township identity proven for Wa de-facto units against Active MIMU township keep/update matches.

## Foreign townships (preserve rows/IDs)

| ID | Name | FK note |
|---:|---|---|
| 5985 | Thai amphoe Wiang Haeng | places/streets/settlements/stops remain; **no reassignment** (no proven Myanmar target) |
| 5986 | Thai amphoe Pang Mapha | same |
| 6675 | Vijoynagar EAC | same |
| 6734 | S' Bungtlang | same |
| 6735 | Tipa | same |

Flags: `address_usage=disabled`, `is_public_usable=false`, `is_official_boundary=false`, `verification_status=needs_fix`. **`is_active` left true** after dependency inspection (cannot safely reassign FKs).

## Duplicates

**No merges in this migration.** Phase 1 duplicate CSV is multi-candidate review only; no entity merge was explicitly approved. Same-name areas retained.

## Names

- Enforce ≤1 primary per `(admin_area_id, language_code)` on affected rows (keep lowest `name_id`, demote extras to aliases).
- 6091 EN primary → `Hsihseng Township`; keep `Sesai Township` as non-primary alias.
- 6410 EN `Hsihseng Township` demoted; primary EN set to `Shi Shan Township`.

## New rows (fixed public_id for rollback)

| Slug | public_id | How geom is built |
|---|---|---|
| `cleanup:pyay-district` | `a1000001-0001-4000-8000-000000000001` | `ST_UnaryUnion` of 7139+6778+7151 (**existing geoms unchanged**) |
| `cleanup:pa-laung-saz` | `a1000001-0001-4000-8000-000000000002` | union of 6394+6527 |
| `cleanup:wa-sad` | `a1000001-0001-4000-8000-000000000003` | union of 6378+6485 |

## Geometry rule

**No `UPDATE` of `geom` on any pre-existing admin row.** Only new rows receive derived union geometries.
