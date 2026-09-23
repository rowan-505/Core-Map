/**
 * High-confidence English → Myanmar for common road words only.
 * Does not invent full place names from romanization reverse.
 */

import { looksLatin, looksMyanmar, trimName } from "./romanize.js";

const ROAD_WORD_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bhighways?\b/gi, "လမ်းမကြီး"],
  [/\broads?\b/gi, "လမ်း"],
  [/\bstreets?\b/gi, "လမ်း"],
  [/\blanes?\b/gi, "လမ်း"],
  [/\bavenues?\b/gi, "လမ်း"],
  [/\bbridges?\b/gi, "တံတား"],
  [/\bstations?\b/gi, "ဘူတာ"],
  [/\bmarkets?\b/gi, "ဈေး"],
  [/\bhospitals?\b/gi, "ဆေးရုံ"],
  [/\bschools?\b/gi, "ကျောင်း"],
  [/\bpagodas?\b/gi, "ဘုရား"],
  [/\btemples?\b/gi, "ဘုရား"],
  [/\bvillages?\b/gi, "ရွာ"],
  [/\b(?:no\.?|number)\s*([0-9]+)\b/gi, "အမှတ် $1"],
];

/**
 * Returns Myanmar text only when the English name is almost entirely
 * covered by known road/place word patterns (high confidence).
 * Pure proper nouns without mapped words return null.
 */
export function englishRoadNameToMyanmar(source: string): {
  text: string;
  confidence: number;
} | null {
  const input = trimName(source);
  if (!input || looksMyanmar(input) || !looksLatin(input)) return null;

  // Only transform when at least one road word is present
  const hasRoadWord = ROAD_WORD_MAP.some(([re]) => {
    re.lastIndex = 0;
    return re.test(input);
  });
  if (!hasRoadWord) return null;

  let out = input;
  let replacements = 0;
  for (const [pattern, replacement] of ROAD_WORD_MAP) {
    pattern.lastIndex = 0;
    if (pattern.test(out)) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, replacement);
      replacements += 1;
    }
  }

  out = out.replace(/\s+/g, " ").trim();
  if (!out || !looksMyanmar(out)) return null;

  // Remaining Latin letters mean proper-noun leftovers — queue, do not auto
  if (/[A-Za-z]{2,}/.test(out)) return null;

  return {
    text: out.slice(0, 500),
    confidence: replacements >= 2 ? 80 : 72,
  };
}

export const MAJOR_ROAD_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link",
]);

export function isMajorRoadClass(roadClass: string | null | undefined): boolean {
  if (!roadClass) return false;
  return MAJOR_ROAD_CLASSES.has(roadClass.trim().toLowerCase());
}
