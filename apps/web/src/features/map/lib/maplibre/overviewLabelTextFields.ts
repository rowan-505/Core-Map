/** Overview tile label fields — Core admin uses name_mm / name_en / name. */
import type { ExpressionSpecification } from 'maplibre-gl';

export const OVERVIEW_LABEL_LAYER_IDS = [
  'overview-country-labels',
  'overview-admin-state-region-labels',
  'overview-populated-places',
] as const;

export type OverviewLabelLayerId = (typeof OVERVIEW_LABEL_LAYER_IDS)[number];

/** Country polygons — uppercase attribute names from Natural Earth. */
export const OVERVIEW_COUNTRY_LABEL_TEXT_FIELD: ExpressionSpecification = [
  'coalesce',
  ['get', 'NAME'],
  ['get', 'ADMIN'],
  ['get', 'NAME_EN'],
  ['get', 'NAME_LONG'],
];

/** Populated places — mixed-case keys from tippecanoe. */
export const OVERVIEW_POPULATED_PLACES_TEXT_FIELD: ExpressionSpecification = [
  'coalesce',
  ['get', 'NAME'],
  ['get', 'NAMEASCII'],
  ['get', 'name'],
  ['get', 'nameascii'],
];

/** Core state/region label points — short overview names (alias or core_id map). */
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_FIELD: ExpressionSpecification = [
  'coalesce',
  ['get', 'label_name_mm'],
  [
    'match',
    ['to-number', ['coalesce', ['get', 'core_id'], 0]],
    13,
    'ရန်ကုန်',
    5089,
    'မွန်',
    5879,
    'ကရင်',
    6007,
    'ကယား',
    6031,
    'နေပြည်တော်',
    6329,
    'ရှမ်း',
    6667,
    'ကချင်',
    6703,
    'စစ်ကိုင်း',
    6722,
    'ရခိုင်',
    6744,
    'ချင်း',
    6832,
    'မန္တလေး',
    7027,
    'မကွေး',
    7169,
    'ပဲခူး',
    7279,
    'ဧရာဝတီ',
    7449,
    'တနင်္သာရီ',
    ['coalesce', ['get', 'name_mm'], ''],
  ],
  ['get', 'label_name_en'],
  ['get', 'name_en'],
  ['get', 'name'],
];

const OVERVIEW_LABEL_TEXT_FIELD_BY_LAYER_ID: Readonly<
  Record<OverviewLabelLayerId, ExpressionSpecification>
> = {
  'overview-country-labels': OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
  'overview-admin-state-region-labels': OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_FIELD,
  'overview-populated-places': OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
};

export function isOverviewLabelLayerId(layerId: string): layerId is OverviewLabelLayerId {
  return (OVERVIEW_LABEL_LAYER_IDS as readonly string[]).includes(layerId);
}

/** Returns overview-specific `text-field` or `null` for non-overview symbol layers. */
export function getOverviewLabelTextField(layerId: string): ExpressionSpecification | null {
  if (!isOverviewLabelLayerId(layerId)) return null;
  return OVERVIEW_LABEL_TEXT_FIELD_BY_LAYER_ID[layerId];
}
