/**
 * Practical Myanmar → Latin romanizer for map label fill.
 * Not full MLCTS; prioritizes readable English labels over linguistic purity.
 */

const MYANMAR_SCRIPT_RE = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/;
const LATIN_LETTER_RE = /[A-Za-z]/;

const CONSONANT: Record<string, string> = {
  "\u1000": "k",
  "\u1001": "kh",
  "\u1002": "g",
  "\u1003": "gh",
  "\u1004": "ng",
  "\u1005": "s",
  "\u1006": "hs",
  "\u1007": "z",
  "\u1008": "zh",
  "\u1009": "ny",
  "\u100A": "ny",
  "\u100B": "t",
  "\u100C": "ht",
  "\u100D": "d",
  "\u100E": "dh",
  "\u100F": "n",
  "\u1010": "t",
  "\u1011": "ht",
  "\u1012": "d",
  "\u1013": "dh",
  "\u1014": "n",
  "\u1015": "p",
  "\u1016": "hp",
  "\u1017": "b",
  "\u1018": "bh",
  "\u1019": "m",
  "\u101A": "y",
  "\u101B": "y",
  "\u101C": "l",
  "\u101D": "w",
  "\u101E": "th",
  "\u101F": "h",
  "\u1020": "l",
  "\u1021": "a",
  "\u1022": "sh",
  "\u1023": "i",
  "\u1024": "i",
  "\u1025": "u",
  "\u1026": "u",
  "\u1027": "e",
  "\u1029": "o",
  "\u102A": "au",
};

const MEDIAL: Record<string, string> = {
  "\u103B": "y",
  "\u103C": "y",
  "\u103D": "w",
  "\u103E": "h",
  "\u105E": "y",
  "\u105F": "y",
  "\u1060": "w",
};

const VOWEL: Record<string, string> = {
  "\u102B": "a",
  "\u102C": "a",
  "\u102D": "i",
  "\u102E": "i",
  "\u102F": "u",
  "\u1030": "u",
  "\u1031": "e",
  "\u1032": "ai",
  "\u1036": "n",
};

const INDEPENDENT_DIGITS: Record<string, string> = {
  "\u1040": "0",
  "\u1041": "1",
  "\u1042": "2",
  "\u1043": "3",
  "\u1044": "4",
  "\u1045": "5",
  "\u1046": "6",
  "\u1047": "7",
  "\u1048": "8",
  "\u1049": "9",
};

/** Common whole-word / phrase replacements applied before character mapping. */
const PHRASE_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/လမ်းမကြီး/g, "Highway"],
  [/အမှတ်/g, "No."],
  [/လမ်း/g, " Road"],
  [/ကျောင်း/g, " School"],
  [/ဘုရား/g, " Pagoda"],
  [/ဆေးရုံ/g, " Hospital"],
  [/ဈေး/g, " Market"],
  [/စျေး/g, " Market"],
  [/ဘူတာ/g, " Station"],
  [/ဆိပ်ကမ်း/g, " Port"],
  [/တံတား/g, " Bridge"],
  [/ရွာ/g, " Village"],
  [/မြို့/g, " Town"],
  [/ခရိုင်/g, " District"],
  [/တိုင်း/g, " Region"],
  [/ပြည်နယ်/g, " State"],
];

export function looksMyanmar(text: string): boolean {
  return MYANMAR_SCRIPT_RE.test(text);
}

export function looksLatin(text: string): boolean {
  return LATIN_LETTER_RE.test(text);
}

export function looksMixedScript(text: string): boolean {
  return looksMyanmar(text) && looksLatin(text);
}

export function trimName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function titleCaseToken(token: string): string {
  if (!token) return token;
  if (/^[0-9.]+$/.test(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Romanize Myanmar script to Latin. Returns null when input has no Myanmar script.
 * Confidence is 85 for pure Myanmar, 70 when mixed.
 */
export function romanizeMyanmarToEnglish(source: string): {
  text: string;
  confidence: number;
} | null {
  const input = trimName(source);
  if (!input || !looksMyanmar(input)) return null;

  let working = input;
  for (const [pattern, replacement] of PHRASE_MAP) {
    working = working.replace(pattern, replacement);
  }

  let out = "";
  for (const ch of working) {
    if (CONSONANT[ch] !== undefined) {
      out += CONSONANT[ch];
      continue;
    }
    if (MEDIAL[ch] !== undefined) {
      out += MEDIAL[ch];
      continue;
    }
    if (VOWEL[ch] !== undefined) {
      out += VOWEL[ch];
      continue;
    }
    if (INDEPENDENT_DIGITS[ch] !== undefined) {
      out += INDEPENDENT_DIGITS[ch];
      continue;
    }
    // Virama / asat / tone marks — skip
    if (
      ch === "\u1039" ||
      ch === "\u103A" ||
      ch === "\u1037" ||
      ch === "\u1038" ||
      ch === "\u1039"
    ) {
      continue;
    }
    if (/[\s\-_/.,()]+/.test(ch) || LATIN_LETTER_RE.test(ch) || /[0-9]/.test(ch)) {
      out += ch;
      continue;
    }
    // Unknown Myanmar mark — skip rather than insert garbage
    if (MYANMAR_SCRIPT_RE.test(ch)) continue;
    out += ch;
  }

  const cleaned = out
    .replace(/\s+/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || !looksLatin(cleaned)) return null;

  return {
    text: cleaned.slice(0, 500),
    confidence: looksMixedScript(input) ? 70 : 85,
  };
}
