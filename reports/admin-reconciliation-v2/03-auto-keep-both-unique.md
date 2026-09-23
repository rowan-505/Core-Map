# Phase 3 auto-decisions for unique / no-candidate rows

**Generated:** 2026-09-21T10:33:55.169365+00:00
**Production writes:** none

## Applied

- Local `keep_both` (unique weak-link): **0**
- Local `create_new` (no candidate): **0**
- Village `keep_both` (unique weak-link): **0**
- Village `create_new` (no candidate): **0**
- Merge plans: **not touched**

## Still need human review

- Local remaining undecided: **21**
- Village remaining undecided: **1566**
- Merge plans: leave for judgment

Rules:
- `keep_both`: 1 candidate + `manual_review` + `no_exact_name` + weak spatial
  (local overlap < 5%, village distance > 200 m)
- `create_new`: 0 candidates + `manual_review`

## Remaining local needing judgment: **21**

- village_tract · Pang Hkam · cand=1 · action=manual_review · evidence=no_exact_name · overlap=6.0 · dist=5404.0 m
- village_tract · Ku Hpyu · cand=1 · action=manual_review · evidence=no_exact_name · overlap=21.8 · dist=2070.7 m
- village_tract · Urban · cand=1 · action=manual_review · evidence=no_exact_name · overlap=100.0 · dist=1024.7 m
- village_tract · Kawng Sang · cand=1 · action=manual_review · evidence=no_exact_name · overlap=100.0 · dist=22665.5 m
- village_tract · Kone Mon · cand=1 · action=manual_review · evidence=no_exact_name · overlap=15.6 · dist=26664.6 m
- village_tract · Loi Pyet · cand=1 · action=manual_review · evidence=no_exact_name · overlap=26.0 · dist=18355.9 m
- village_tract · Loi Waw · cand=1 · action=manual_review · evidence=no_exact_name · overlap=95.8 · dist=9769.7 m
- village_tract · Man Kat · cand=1 · action=manual_review · evidence=no_exact_name · overlap=12.1 · dist=21982.5 m
- village_tract · Man Kawng Mu · cand=1 · action=manual_review · evidence=no_exact_name · overlap=62.6 · dist=14165.8 m
- village_tract · Nam Hu · cand=1 · action=manual_review · evidence=no_exact_name · overlap=83.8 · dist=9262.0 m
- village_tract · Nam Muse · cand=1 · action=manual_review · evidence=no_exact_name · overlap=10.9 · dist=24078.9 m
- village_tract · Nawng Hkam (Mong Htwun) · cand=1 · action=manual_review · evidence=no_exact_name · overlap=93.4 · dist=16182.4 m
- village_tract · Nawng Hkam (Mong Mar) · cand=1 · action=manual_review · evidence=no_exact_name · overlap=86.6 · dist=6711.2 m
- village_tract · Nawng Lai · cand=1 · action=manual_review · evidence=no_exact_name · overlap=96.2 · dist=14497.3 m
- village_tract · Pang Lawng · cand=1 · action=manual_review · evidence=no_exact_name · overlap=99.6 · dist=32965.3 m
- village_tract · Pang Nyawng · cand=1 · action=manual_review · evidence=no_exact_name · overlap=23.8 · dist=16334.0 m
- village_tract · Kying Yang Ton · cand=1 · action=manual_review · evidence=no_exact_name · overlap=5.6 · dist=4031.4 m
- village_tract · Nam Pang · cand=1 · action=manual_review · evidence=no_exact_name · overlap=5.1 · dist=8712.6 m
- village_tract · Ka Naing Dar · cand=1 · action=manual_review · evidence=no_exact_name · overlap=15.7 · dist=3535.2 m
- village_tract · Shin Moke Tee · cand=1 · action=manual_review · evidence=no_exact_name · overlap=39.1 · dist=3462.0 m
- village_tract · Sin Sa Khan · cand=1 · action=manual_review · evidence=no_exact_name · overlap=6.0 · dist=3954.0 m

## Remaining village needing judgment: **1566**

- village · Pay Chaung · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=239.3 m
- village · Ma Ngeit Ka Lay · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=16.3 m
- village · Kyar · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Khit San · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=44.6 m
- village · Aye · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=215.7 m
- village · Leik Ka Bar · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · U To · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Ma Ngeit Gyi · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=190.2 m
- village · Paw Taw Mu · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=34.9 m
- village · Ka Zaung Lay · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=219.8 m
- village · Sar Hpyu Su · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=163.2 m
- village · Sar Hpyu Su · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=300.5 m
- village · Ta Yoke Seik · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=131.6 m
- village · Tone Le · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=51.3 m
- village · Ah Kaw · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Shwe Bo Su · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=8090.9 m
- village · Kyein Chaung Gyi · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=169.8 m
- village · Lay Ein Tan · cand=4 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Sin Thay Kwayt · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=123.7 m
- village · Aye · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=162.3 m
- village · Leik Ka Bar · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=316.4 m
- village · Ka Zaung Lay · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Kyar Chaung · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · U To · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Htone Bu Kwe · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Kyar · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Ma Ngeit Gyi · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Ma Ngeit Ka Lay · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=59.4 m
- village · Lay Ein Tan · cand=4 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=273.8 m
- village · Sin Thay Kwayt · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=215.0 m
- village · Thu Htay Kone · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=24676.3 m
- village · Khit San · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=12.1 m
- village · Thar Hpyan Gyi · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=68.4 m
- village · Htone Bu Kwe · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=144.7 m
- village · Kyar Chaung · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=0.0 m
- village · Ah Kaw · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=116.1 m
- village · Ta Yoke Seik · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=354.4 m
- village · Tone Le · cand=3 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=120.7 m
- village · Paw Taw Mu · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=625.0 m
- village · Ka Nyin Kauk · cand=2 · action=merge_duplicate_candidate · evidence=exact_normalized_my · overlap=— · dist=78.4 m
- … and 1526 more
