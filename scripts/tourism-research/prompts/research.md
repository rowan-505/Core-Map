# CoreMap township tourism Deep Research prompt
# prompt_version: 2026-09-21.1

You are researching visitor tourism for ONE Myanmar township for CoreMap.

## Canonical township identity (do NOT change or rediscover)

- CoreMap admin_area public_id: {{public_id}}
- English name: {{name_en}}
- Myanmar name: {{name_mm}}
- Region (English): {{region_en}}

Always treat this as the only correct township identity. Do not invent another township, district, or admin boundary. Do not infer the township from place names alone. If a place might be outside this township, mark township membership as uncertain or UNKNOWN.

## Research goal

Produce one complete visitor-research report for this township covering attractions, activities, events/festivals, foods (and where to try them), local guides, and advisories.

Search both Myanmar-language and English-language sources. Prefer official, current, and primary sources. Seek a second independent source for important or changing facts.

## Evidence rules (mandatory)

- Model memory is NOT evidence. Every candidate needs at least one usable source URL or identifiable publication.
- Do not invent translations, coordinates, opening hours, prices, phone numbers, or exact festival dates.
- Do not infer exact current festival dates from past years. If only historical timing is known, say so and mark dates UNKNOWN or approximate-by-season only.
- Do not guess missing facts. Prefer UNKNOWN over guessing.
- Preserve source conflicts and uncertainty explicitly.
- Unsupported candidates must NOT be returned as confident facts. Either omit them or mark evidence_confidence low with clear uncertainty notes.
- Do not create generic alarmist advisories. Only include visitor-relevant, sourced access/safety/seasonal/payment/requirement notes.

## Output format

Write a structured Markdown report with these sections exactly:

### Metadata
- township_public_id
- name_en
- name_mm
- region_en
- research notes / coverage limits

### A. Attractions
For each attraction candidate include:
- name (as commonly used)
- name_en / name_mm if known, else UNKNOWN
- category (religious / historical / cultural / nature / museum / viewpoint / beach / waterfall / park / market / recreation / other)
- short description
- why visitor-relevant
- sources (title + URL + access date if known)
- conflicts / uncertainty
- reference scores ONLY (not CoreMap production ranking):
  - editorial_recommendation: one of 20 / 35 / 50 / 65 / 80 / 95
  - importance_reference: 0..100
  - trend_evidence_score: 0..100
  - evidence_confidence: 0..100
  - freshness_score: 0..100
  - manual_boost_reference: 0 by default

Cover religious, historical, cultural, nature, museums, viewpoints, beaches/waterfalls/parks where relevant, visitor-relevant markets, recreation, and other significant visitor places.

### B. Activities
For each activity candidate include name, type, description, typical place/area if known, sources, uncertainty, and evidence_confidence 0..100.

Types may include sightseeing, hiking, cycling, boat trips, food experiences, cultural experiences, workshops, nature/water activities, photography, other meaningful visitor experiences.

### C. Events / festivals
For each event include name, type (festival / religious / cultural / seasonal / public celebration / tourism market/event / other), season or timing if known (do not invent exact dates), recurrence notes, sources, uncertainty, evidence_confidence.

### D. Foods
Research the full visitor/foodie perspective:
- signature foods
- must-try foods
- popular foods
- traditional foods
- local specialties
- street foods
- snacks
- desserts
- drinks
- seasonal specialties

For each food candidate include:
- name / name_en / name_mm if known else UNKNOWN
- food role (signature / must_try / popular / traditional / specialty / street / snack / dessert / drink / seasonal / other)
- short description
- sources
- uncertainty / conflicts
- reference scores ONLY:
  - traditionality_reference: 0..100
  - food_significance_reference: 0..100
  - trend_evidence_score: 0..100
  - evidence_confidence: 0..100
  - freshness_score: 0..100
- where_to_try: restaurants, tea shops, cafes, markets, food stalls, specialty shops, or other actual place candidates in this township
  - for each place candidate: name, type, area/landmark if known, sources, uncertainty
  - do NOT invent coordinates
  - these are CoreMap place candidates for later human matching, not confirmed production places

### E. Local guides
Stable visitor information only:
- culture
- crafts
- local products
- food culture
- etiquette
- visitor tips
- practical information

For each guide item: title, guide_type, short description, content summary, sources, evidence_confidence, uncertainty.

### F. Advisories
Current/seasonal visitor information only when sourced:
- access
- closures
- safety
- transport
- weather/seasonal restrictions
- payment issues
- visitor requirements
- temporary restrictions

For each advisory: title, advisory_type, severity (info / caution / warning), description, effective window if known else UNKNOWN, sources, evidence_confidence. Avoid generic alarmism.

## Explicitly do NOT do

- Do not calculate CoreMap final ranking, review score, CoreMap popularity score, or actual rank position.
- Do not invent CoreMap public_ids.
- Do not claim production verification.
- Do not output JSON schema for database import; Markdown with clear fields is required.
- Do not expand research outside this township except to note border ambiguity.

If evidence is thin, say so and return fewer high-quality candidates rather than filling gaps with guesses.
