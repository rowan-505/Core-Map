/**
 * Deterministic candidate keys for idempotent imports.
 */

import { createHash } from "node:crypto";

export function slugify(input: string): string {
  const basic = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u1000-\u109f]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return basic || "unnamed";
}

export function buildCandidateKey(
  entityType: string,
  name: string,
  disambiguator?: string | null,
): string {
  const base = `${entityType}:${slugify(name)}`;
  if (!disambiguator?.trim()) return base.slice(0, 200);
  const extra = slugify(disambiguator);
  return `${base}:${extra}`.slice(0, 200);
}

/** Short stable suffix from a source URL or text when names collide. */
export function shortStableSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/**
 * Ensure candidate keys are unique within a document by appending suffixes on collision.
 */
export function ensureUniqueCandidateKeys<
  T extends { candidate_key: string; entity_type: string; name: string; payload: { sources?: Array<{ url?: string | null }> } },
>(candidates: T[]): T[] {
  const seen = new Map<string, number>();
  return candidates.map((c) => {
    let key = c.candidate_key?.trim() || buildCandidateKey(c.entity_type, c.name);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count > 0) {
      const source = c.payload.sources?.[0]?.url ?? `${c.name}:${count}`;
      key = buildCandidateKey(c.entity_type, c.name, shortStableSuffix(String(source)));
      // still collide?
      let n = 2;
      while (seen.has(key)) {
        key = buildCandidateKey(c.entity_type, c.name, `${shortStableSuffix(String(source))}-${n}`);
        n += 1;
      }
      seen.set(key, 1);
    }
    return { ...c, candidate_key: key };
  });
}
