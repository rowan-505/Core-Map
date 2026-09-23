# Administrative and postal reconciliation audit

Read-only audit date: 2026-09-21. No production rows, schemas, migrations, tiles, or search indexes were changed.

## Source populations and proposed actions

| Level | Official MIMU rows | blocked_missing_legal_geometry | create_missing | duplicate_merge_candidate | exact_keep | manual_review | reclassify | update_names | update_parent | Required five-action subtotal | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| state_region | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 15 | 0 |
| district | 75 | 3 | 0 | 0 | 0 | 0 | 0 | 70 | 2 | 72 | 3 |
| self_administered_zone | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| township | 330 | 2 | 0 | 0 | 5 | 1 | 0 | 232 | 90 | 327 | 3 |
| ward_village_tract | 17069 | 14992 | 124 | 14 | 0 | 58 | 4 | 1877 | 0 | 2005 | 15064 |

The requested five-action equation is shown explicitly. Any gap is composed of `manual_review`, `duplicate_merge_candidate`, or `blocked_missing_legal_geometry`; treating those rows as approved creates would be unsafe.

Township official target: **330**. The source workbook contains exactly 330 rows with `GAD_Township_Status=Active`.

## Rechecked production baseline

| Metric | Value | Detail |
|---|---:|---|
| level_count:country | 1 | 1 |
| level_count:district | 116 | 116 |
| level_count:self_administered_zone | 3 | 3 |
| level_count:state_region | 17 | 17 |
| level_count:town | 20 | 20 |
| level_count:township | 364 | 366 |
| level_count:ward_village_tract | 1995 | 1995 |
| township_centroid_outside_immediate_parent | 42 |  |
| township_exact_duplicate_name_extra_rows_cross_area | 4 |  |
| township_exact_duplicate_name_extra_rows_same_area | 289 |  |
| township_geom_not_completely_covered_by_parent | 135 |  |
| townships_without_primary_en | 67 |  |
| townships_without_primary_my | 6 |  |
| active_townships_marked_official_boundary | 364 | of 364 active townships |
| active_townships_marked_public_usable | 364 | of 364 active townships |
| active_townships_marked_both_official_and_public | 364 | of 364 active townships |

## Postal audit

- source_rows_en: 17331
- source_rows_my: 17331
- valid_rows_en: 17330
- valid_rows_my: 17330
- unique_valid_codes: 17297
- duplicate_extra_rows_en: 33
- duplicate_extra_rows_my: 33
- malformed_codes: ['114560']
- sha256_en_csv: a77b85f6bf3be7b4ed6fe54bcc4a962b9454cd7f9e49f677c9884b2f5842a5ae
- sha256_my_csv: 2964b0097e3f586f8f3b7c1a5318b4ce17e242f656cf6fde1d3fd3bd6d8c9b54
- sha256_zip: 782daf6918f7355d9445ab417a9b20015bb49d6fb732a760571adc55635496ca

### Required postal reconciliation rollup

| Metric | Count |
|---|---:|
| Exact township-name matches to CoreMap | 12799 |
| Exact town-name to parent-township matches | 454 |
| Exact WVT matches to CoreMap | 1411 |
| Alias matches | 0 |
| Ambiguous (township or local) | 283 |
| Unmatched / Core township unresolved | 4030 |
| Type conflicts | 38 |

### Postal match status

| Status | Count |
|---|---:|
| ambiguous | 14 |
| ambiguous_local_admin | 269 |
| exact_local_admin_match | 1411 |
| township_only | 11535 |
| township_source_match_core_unresolved | 81 |
| type_conflict | 38 |
| unmatched_postal_locality | 3949 |

### Valid codes by source region

| Region | Count |
|---|---:|
| Ayeyarwady Region | 2230 |
| Bago Region (East) | 943 |
| Bago Region (West) | 823 |
| Chin State | 543 |
| Kachin State | 784 |
| Kayah state | 124 |
| Kayin State | 463 |
| Magway Region | 1746 |
| Mandalay Region | 1703 |
| Mon State | 494 |
| Naypyitaw Union Territory | 248 |
| Rakhine State | 1245 |
| Sagaing Region | 2038 |
| Shan State (East) | 289 |
| Shan State (North) | 1220 |
| Shan State (South) | 674 |
| Tanintharyi Region | 358 |
| Yangon Region | 1372 |

### Valid codes by source region and township

| Region | Township / town | Count |
|---|---|---:|
| Ayeyarwady Region | Ahmar Town | 4 |
| Ayeyarwady Region | Ahtaung Town | 4 |
| Ayeyarwady Region | Ahthoke Town | 5 |
| Ayeyarwady Region | Batye Town | 2 |
| Ayeyarwady Region | Bogale Township | 86 |
| Ayeyarwady Region | Chaung Thar Town | 3 |
| Ayeyarwady Region | Danubyu Township | 81 |
| Ayeyarwady Region | Dedaye Township | 93 |
| Ayeyarwady Region | Du Yar Town | 5 |
| Ayeyarwady Region | Einme Township | 103 |
| Ayeyarwady Region | Hainggyikyun Town | 3 |
| Ayeyarwady Region | Hinthada Township | 124 |
| Ayeyarwady Region | Htoogyi Town | 5 |
| Ayeyarwady Region | In Pin Town | 4 |
| Ayeyarwady Region | Ingapu Township | 77 |
| Ayeyarwady Region | Kanaung Town | 5 |
| Ayeyarwady Region | Kangyidaunt Township | 80 |
| Ayeyarwady Region | Kyaiklat Township | 93 |
| Ayeyarwady Region | Kyangin Township | 33 |
| Ayeyarwady Region | Kyaunggon Township | 68 |
| Ayeyarwady Region | Kyonmangae Town | 5 |
| Ayeyarwady Region | Kyonpyaw Town Township | 94 |
| Ayeyarwady Region | Labutta (3) Mile Town | 4 |
| Ayeyarwady Region | Labutta Township | 75 |
| Ayeyarwady Region | Lemyethna Township | 48 |
| Ayeyarwady Region | Maubin Township | 88 |
| Ayeyarwady Region | Mawlamyinegyun Township | 121 |
| Ayeyarwady Region | Me Za Li Kone Town | 4 |
| Ayeyarwady Region | Myanaung Township | 64 |
| Ayeyarwady Region | Myaungmya Township | 114 |
| Ayeyarwady Region | Ngapudaw Township | 87 |
| Ayeyarwady Region | Ngathaingchaung Town | 6 |
| Ayeyarwady Region | Ngayokekaung Town | 2 |
| Ayeyarwady Region | Ngwesaung Town | 4 |
| Ayeyarwady Region | Nyaungdon Township | 54 |
| Ayeyarwady Region | Pantanaw Township | 56 |
| Ayeyarwady Region | Pathein Township | 68 |
| Ayeyarwady Region | Pyapon Township | 71 |
| Ayeyarwady Region | Pyinsalu Town | 3 |
| Ayeyarwady Region | Shwethaungyan Town | 3 |
| Ayeyarwady Region | Ta Loke Htaw Town | 5 |
| Ayeyarwady Region | Thabaung Township | 70 |
| Ayeyarwady Region | Wakema Township | 142 |
| Ayeyarwady Region | Yegyi Township | 93 |
| Ayeyarwady Region | Zalun Township | 71 |
| Bago Region (East) | Bago Township | 100 |
| Bago Region (East) | Daik-U Township | 53 |
| Bago Region (East) | Hpa Do Town | 5 |
| Bago Region (East) | Hpayargyi Town | 3 |
| Bago Region (East) | Hswar Town | 2 |
| Bago Region (East) | Htantabin Township | 35 |
| Bago Region (East) | Inntakaw Town | 6 |
| Bago Region (East) | Kanyutkwin Town | 4 |
| Bago Region (East) | Kawa Township | 98 |
| Bago Region (East) | Kaytumati Town | 4 |
| Bago Region (East) | Kyaukkyi Township | 53 |
| Bago Region (East) | Kyauktaga Township | 52 |
| Bago Region (East) | Kywe Pwe Town | 5 |
| Bago Region (East) | Madauk Town | 2 |
| Bago Region (East) | Myo Hla Town | 5 |
| Bago Region (East) | Nyaunglebin Township | 54 |
| Bago Region (East) | Oktwin Township | 47 |
| Bago Region (East) | Peinzalok Town | 2 |
| Bago Region (East) | Penwegon Town | 8 |
| Bago Region (East) | Phyu Township | 71 |
| Bago Region (East) | Pyuntasa Town | 4 |
| Bago Region (East) | Shwegyin Township | 68 |
| Bago Region (East) | Taungoo Township | 60 |
| Bago Region (East) | Thanatpin Township | 66 |
| Bago Region (East) | Thetkala Town | 6 |
| Bago Region (East) | Waw Township | 64 |
| Bago Region (East) | Yae Ni Town | 4 |
| Bago Region (East) | Yedashe Township | 58 |
| Bago Region (East) | Zayyawadi Town | 4 |
| Bago Region (West) | Gyobingauk Township | 59 |
| Bago Region (West) | Inn Ma Town | 5 |
| Bago Region (West) | Letpadan Township | 53 |
| Bago Region (West) | Minhla Township | 63 |
| Bago Region (West) | Monyo Township | 42 |
| Bago Region (West) | Nattalin Township | 82 |
| Bago Region (West) | Oakshitpin Town | 3 |
| Bago Region (West) | Oe Thei Kone Town | 4 |
| Bago Region (West) | Okpho Township | 60 |
| Bago Region (West) | Padaung Township | 47 |
| Bago Region (West) | Paukkhaung Township | 58 |
| Bago Region (West) | Paungdale Town | 4 |
| Bago Region (West) | Paungde Township | 56 |
| Bago Region (West) | Puteekone Town | 2 |
| Bago Region (West) | Pyay Township | 66 |
| Bago Region (West) | Shwedaung Township | 51 |
| Bago Region (West) | Sin Mee Swea Town | 3 |
| Bago Region (West) | Sit Kwin Town | 4 |
| Bago Region (West) | Tar Pun Town | 3 |
| Bago Region (West) | Thayarwady Township | 56 |
| Bago Region (West) | Thegon Township | 55 |
| Bago Region (West) | Thonse Town | 13 |
| Bago Region (West) | Zigon Township | 34 |
| Chin State | Cikha Town | 2 |
| Chin State | Falam Township | 94 |
| Chin State | Hakha Township | 38 |
| Chin State | Hnaring Town | 2 |
| Chin State | Kanpetlet Township | 28 |
| Chin State | Khaikam Town | 4 |
| Chin State | Kyin Dway Town | 4 |
| Chin State | Lalengpi Town | 2 |
| Chin State | M'kuiimnu Town | 4 |
| Chin State | Matupi Township | 67 |
| Chin State | Mindat Township | 50 |
| Chin State | Paletwa Township | 101 |
| Chin State | Rezua Town | 4 |
| Chin State | Rihkhawdar Town | 2 |
| Chin State | Samee Town | 3 |
| Chin State | Surkhua Town | 2 |
| Chin State | Tedim Township | 59 |
| Chin State | Thantlang Township | 40 |
| Chin State | Tonzang Township | 33 |
| Chin State | Webula Town | 4 |
| Kachin State | Bhamo Township | 61 |
| Kachin State | Chipwi Township | 46 |
| Kachin State | Dawthponeyan Town | 3 |
| Kachin State | Hopin Town | 4 |
| Kachin State | Hpakant Township | 20 |
| Kachin State | Injangyang Township | 67 |
| Kachin State | Inn Taw Gyi Town | 4 |
| Kachin State | Kamaing Town | 1 |
| Kachin State | Kan Paik Ti Town | 3 |
| Kachin State | Khaunglanhpu Township | 28 |
| Kachin State | Lwegel Town | 7 |
| Kachin State | Machanbaw Township | 31 |
| Kachin State | Mansi Township | 44 |
| Kachin State | Mogaung Township | 51 |
| Kachin State | Mohnyin Township | 44 |
| Kachin State | Momauk Township | 56 |
| Kachin State | Myitkyina Township | 58 |
| Kachin State | Myo Hla Town | 4 |
| Kachin State | Nam Mar Town | 5 |
| Kachin State | Nam Mun Town | 4 |
| Kachin State | Nammatee Town | 4 |
| Kachin State | Nawngmun Township | 18 |
| Kachin State | Pang War Town | 3 |
| Kachin State | Pannandin Town | 1 |
| Kachin State | Puta-O Township | 25 |
| Kachin State | Sadung Town | 5 |
| Kachin State | Shin Bway Yang Town | 4 |
| Kachin State | Shwegu Township | 41 |
| Kachin State | Sinbo Town | 3 |
| Kachin State | Sumprabum Township | 44 |
| Kachin State | Tanai Township | 24 |
| Kachin State | Tsawlaw Township | 26 |
| Kachin State | Waingmaw Township | 45 |
| Kayah state | Bawlake Township | 11 |
| Kayah state | Demoso Township | 27 |
| Kayah state | Hpasawng Township | 10 |
| Kayah state | Hpruso Township | 19 |
| Kayah state | Loikaw Township | 32 |
| Kayah state | Loilen Lay Town | 3 |
| Kayah state | Mese Township | 8 |
| Kayah state | Nan Mei Khon Town | 4 |
| Kayah state | Shadaw Township | 8 |
| Kayah state | Ywarthit Town | 2 |
| Kayin State | Baw Ga Li Town | 4 |
| Kayin State | Hlaingbwe Township | 76 |
| Kayin State | Hpa-An Township | 101 |
| Kayin State | Hpapun Township | 37 |
| Kayin State | Hpayarthonesu Town | 4 |
| Kayin State | Kamarmaung Town | 4 |
| Kayin State | Kawkareik Township | 60 |
| Kayin State | Kyaikdon Town | 6 |
| Kayin State | Kyainseikgyi Township | 57 |
| Kayin State | Kyondoe Town | 4 |
| Kayin State | Leik Tho Town | 6 |
| Kayin State | Myawaddy Township | 24 |
| Kayin State | Paingkyon Town | 5 |
| Kayin State | Shan Ywar Thit Town | 4 |
| Kayin State | Su Ka Li Town | 1 |
| Kayin State | Thandaung Town | 4 |
| Kayin State | Thandaunggyi Township | 64 |
| Kayin State | Waw Lay Myaing (Waw Lay) Town | 2 |
| Magway Region | Aunglan Township | 101 |
| Magway Region | Chauk Township | 66 |
| Magway Region | Gangaw Township | 75 |
| Magway Region | Kamma (PKU) Town | 12 |
| Magway Region | Kamma Township | 56 |
| Magway Region | Kyaukhtu Town | 3 |
| Magway Region | Kyaw Town | 3 |
| Magway Region | Magway Township | 78 |
| Magway Region | Minbu Township | 71 |
| Magway Region | Mindon Township | 76 |
| Magway Region | Minhla Township | 69 |
| Magway Region | Myaing Township | 84 |
| Magway Region | Myit Chay Town | 8 |
| Magway Region | Myothit Township | 52 |
| Magway Region | Natmauk Township | 80 |
| Magway Region | Ngape Township | 33 |
| Magway Region | Pakokku Township | 70 |
| Magway Region | Pauk Township | 75 |
| Magway Region | Pwintbyu Township | 56 |
| Magway Region | Sa Lay Town | 5 |
| Magway Region | Saku Town | 3 |
| Magway Region | Salin Township | 110 |
| Magway Region | Saw Township | 65 |
| Magway Region | Seikphyu Township | 47 |
| Magway Region | Sidoktaya Township | 48 |
| Magway Region | Sinbaungwe Township | 49 |
| Magway Region | Sinphyukyun Town | 3 |
| Magway Region | Taungdwingyi Township | 82 |
| Magway Region | Thayet Township | 61 |
| Magway Region | Tilin Township | 73 |
| Magway Region | Yenangyaung Township | 43 |
| Magway Region | Yesagyo Township | 89 |
| Mandalay Region | Amarapura Township | 50 |
| Mandalay Region | Aungmyaythazan Township | 19 |
| Mandalay Region | Bagan Town | 6 |
| Mandalay Region | Chanayethazan Township | 20 |
| Mandalay Region | Chanmyathazi Township | 14 |
| Mandalay Region | Ku Me Town | 5 |
| Mandalay Region | Kyaukpadaung Township | 121 |
| Mandalay Region | Kyaukse Township | 97 |
| Mandalay Region | Madaya Township | 88 |
| Mandalay Region | Mahaaungmyay Township | 18 |
| Mandalay Region | Mahlaing Township | 56 |
| Mandalay Region | Meiktila Township | 72 |
| Mandalay Region | Mogoke Township | 35 |
| Mandalay Region | Myingyan Township | 86 |
| Mandalay Region | Myitnge Town | 1 |
| Mandalay Region | Myittha Township | 88 |
| Mandalay Region | Natogyi Township | 72 |
| Mandalay Region | Ngathayauk Town | 4 |
| Mandalay Region | Ngazun Township | 48 |
| Mandalay Region | Nyaung-U Township | 83 |
| Mandalay Region | Patheingyi Township | 59 |
| Mandalay Region | Pyawbwe Township | 84 |
| Mandalay Region | Pyigyitagon Township | 18 |
| Mandalay Region | Pyinoolwin Township | 59 |
| Mandalay Region | Si Mee Khon Town | 4 |
| Mandalay Region | Singu Township | 39 |
| Mandalay Region | Sintgaing Township | 53 |
| Mandalay Region | Tada-U Township | 64 |
| Mandalay Region | Takaung Town | 3 |
| Mandalay Region | Taungtha Township | 83 |
| Mandalay Region | Thabeikkyin Township | 24 |
| Mandalay Region | Thazi Township | 87 |
| Mandalay Region | Wundwin Township | 75 |
| Mandalay Region | Yamethin Township | 68 |
| Mon State | Bilin Township | 56 |
| Mon State | Chaungzon Township | 46 |
| Mon State | Kamarwet Town | 5 |
| Mon State | Khawzar Town | 2 |
| Mon State | Kyaikkhami Town | 6 |
| Mon State | Kyaikmaraw Township | 48 |
| Mon State | Kyaikto Township | 42 |
| Mon State | Lamaing Town | 3 |
| Mon State | Mawlamyine Township | 48 |
| Mon State | Mudon Township | 42 |
| Mon State | Paung Township | 55 |
| Mon State | Thanbyuzayat Township | 36 |
| Mon State | Thaton Township | 55 |
| Mon State | Thein Za Yat Town | 4 |
| Mon State | Thuwunnawady Town | 3 |
| Mon State | Ye Township | 39 |
| Mon State | Zinkyaik Town | 4 |
| Naypyitaw Union Territory | Det Khi Na Thi Ri Township | 10 |
| Naypyitaw Union Territory | Lewe Township | 67 |
| Naypyitaw Union Territory | Oke Ta Ra Thi Ri Township | 10 |
| Naypyitaw Union Territory | Poke Ba Thi Ri Township | 35 |
| Naypyitaw Union Territory | Pyinmana Township | 38 |
| Naypyitaw Union Territory | Tatkon Township | 55 |
| Naypyitaw Union Territory | Za Bu Thi Ri Township | 15 |
| Naypyitaw Union Territory | Zay Yar Thi Ri Township | 18 |
| Rakhine State | Ann Township | 38 |
| Rakhine State | Buthidaung Township | 85 |
| Rakhine State | Gwa Township | 36 |
| Rakhine State | Kanhtauntkyi Town | 5 |
| Rakhine State | Kha Maung Seik Town | 5 |
| Rakhine State | Kyaukpyu Township | 71 |
| Rakhine State | Kyauktaw Township | 84 |
| Rakhine State | Kyeintali Town | 3 |
| Rakhine State | Lay Taung Town | 5 |
| Rakhine State | Ma-Ei Town | 4 |
| Rakhine State | Maungdaw Township | 108 |
| Rakhine State | Minbya Township | 70 |
| Rakhine State | Mrauk-U Township | 103 |
| Rakhine State | Munaung Township | 41 |
| Rakhine State | Myebon Township | 68 |
| Rakhine State | Myin Hlut Town | 8 |
| Rakhine State | Ngapali Town | 5 |
| Rakhine State | Pauktaw Township | 58 |
| Rakhine State | Ponnagyun Township | 96 |
| Rakhine State | Ramree Township | 57 |
| Rakhine State | Rathedaung Township | 92 |
| Rakhine State | Sa Ne Town | 5 |
| Rakhine State | Sittwe Township | 60 |
| Rakhine State | Tan Hlwe Ywar Ma Town | 6 |
| Rakhine State | Tat Taung Town | 3 |
| Rakhine State | Taungpyoletwea Town | 5 |
| Rakhine State | Thandwe Township | 67 |
| Rakhine State | Toungup Township | 57 |
| Sagaing Region | Ayadaw Township | 41 |
| Sagaing Region | Banmauk Township | 50 |
| Sagaing Region | Budalin Township | 57 |
| Sagaing Region | Chaung-U Township | 32 |
| Sagaing Region | Don Hee Town Town | 3 |
| Sagaing Region | Hkamti Township | 32 |
| Sagaing Region | Homalin Township | 79 |
| Sagaing Region | Htan Par Kway Town | 1 |
| Sagaing Region | Indaw Township | 44 |
| Sagaing Region | Kale Township | 60 |
| Sagaing Region | Kalewa Township | 39 |
| Sagaing Region | Kanbalu Township | 90 |
| Sagaing Region | Kani Township | 48 |
| Sagaing Region | Katha Township | 42 |
| Sagaing Region | Kawlin Township | 54 |
| Sagaing Region | Khampat Town | 5 |
| Sagaing Region | Khin-U Township | 64 |
| Sagaing Region | Kyauk Myaung Town | 4 |
| Sagaing Region | Kyunhla Township | 38 |
| Sagaing Region | Lahe Township | 40 |
| Sagaing Region | Lay Shi Township | 24 |
| Sagaing Region | Maw Lu Town | 6 |
| Sagaing Region | Mawlaik Township | 30 |
| Sagaing Region | Mingin Township | 64 |
| Sagaing Region | Mo Paing Lut Town | 2 |
| Sagaing Region | Monywa Township | 85 |
| Sagaing Region | Myaung Township | 53 |
| Sagaing Region | Myinmu Township | 52 |
| Sagaing Region | Myothit Town | 3 |
| Sagaing Region | Nanyun Township | 70 |
| Sagaing Region | Pale Township | 61 |
| Sagaing Region | Pansaung Town | 3 |
| Sagaing Region | Paungbyin Township | 42 |
| Sagaing Region | Pinlebu Township | 54 |
| Sagaing Region | Sagaing Township | 100 |
| Sagaing Region | Saing Pyin Town | 5 |
| Sagaing Region | Salingyi Township | 42 |
| Sagaing Region | Sar Taung Town | 11 |
| Sagaing Region | Shwe Pyi Aye Town | 11 |
| Sagaing Region | Shwebo Township | 83 |
| Sagaing Region | Sum Ma Rar Town | 3 |
| Sagaing Region | Tabayin Township | 58 |
| Sagaing Region | Tamu Township | 26 |
| Sagaing Region | Taze Township | 61 |
| Sagaing Region | Tigyaing Township | 33 |
| Sagaing Region | Wetlet Township | 72 |
| Sagaing Region | Wuntho Township | 42 |
| Sagaing Region | Ye-U Township | 67 |
| Sagaing Region | Yinmarbin Township | 46 |
| Sagaing Region | Zee Kone Town | 6 |
| Shan State (East) | Hmone Hta Town | 3 |
| Shan State (East) | Ho Tawng (Ho Tao) Township | 5 |
| Shan State (East) | Kenglat Town | 3 |
| Shan State (East) | Kengtung Township | 36 |
| Shan State (East) | Mong Pawk Township | 7 |
| Shan State (East) | Monghpyak Township | 25 |
| Shan State (East) | Monghsat Township | 33 |
| Shan State (East) | Mongkhet Township | 18 |
| Shan State (East) | Mongkhoke Town | 3 |
| Shan State (East) | Mongla Township | 11 |
| Shan State (East) | Mongping Township | 32 |
| Shan State (East) | Mongton Township | 20 |
| Shan State (East) | Mongyang Township | 26 |
| Shan State (East) | Mongyawng Township | 29 |
| Shan State (East) | Mongyu Town | 1 |
| Shan State (East) | Ponparkyin Town | 5 |
| Shan State (East) | Tachileik Township | 24 |
| Shan State (East) | Tarlay Town | 4 |
| Shan State (East) | Tontar Town | 4 |
| Shan State (North) | Chinshwehaw Town | 6 |
| Shan State (North) | Hopang Township | 64 |
| Shan State (North) | Hseni Township | 36 |
| Shan State (North) | Hsipaw Township | 78 |
| Shan State (North) | Konkyan Township | 36 |
| Shan State (North) | Kunlong Township | 31 |
| Shan State (North) | Kutkai Township | 81 |
| Shan State (North) | Kyaukme Township | 85 |
| Shan State (North) | Lashio Township | 90 |
| Shan State (North) | Laukkaing Township | 39 |
| Shan State (North) | Mabein Township | 24 |
| Shan State (North) | Man Kan Town | 3 |
| Shan State (North) | Manhlyoe (Manhero) Town | 3 |
| Shan State (North) | Manton Township | 32 |
| Shan State (North) | Matman Township | 30 |
| Shan State (North) | Maw Hteik Town | 3 |
| Shan State (North) | Monekoe Town | 7 |
| Shan State (North) | Monglon Town | 6 |
| Shan State (North) | Mongmao Township | 40 |
| Shan State (North) | Mongmit Township | 32 |
| Shan State (North) | Mongngawt Town | 5 |
| Shan State (North) | Mongyai Township | 31 |
| Shan State (North) | Muse Township | 73 |
| Shan State (North) | Nam Tit Town | 5 |
| Shan State (North) | Namhkan Township | 58 |
| Shan State (North) | Namhsan Township | 33 |
| Shan State (North) | Namtu Township | 26 |
| Shan State (North) | Narphan Township | 34 |
| Shan State (North) | Nawnghkio Township | 41 |
| Shan State (North) | Pan Lon Town | 8 |
| Shan State (North) | Pang Hseng (Kyu Koke) Town | 5 |
| Shan State (North) | Pangsang (Panghkam) Township | 88 |
| Shan State (North) | Pangwaun Township | 19 |
| Shan State (North) | Tangyan Township | 59 |
| Shan State (North) | Tarmoenye Town | 8 |
| Shan State (North) | Wein Kawn Town | 1 |
| Shan State (South) | - / Pinlon Town | 4 |
| Shan State (South) | Aungpan Town | 12 |
| Shan State (South) | Ayetharyar Town | 12 |
| Shan State (South) | He Hoe Town | 5 |
| Shan State (South) | Homein Town | 3 |
| Shan State (South) | Hopong Township | 28 |
| Shan State (South) | Hsihseng Township | 19 |
| Shan State (South) | Intaw Town | 6 |
| Shan State (South) | Kalaw Township | 37 |
| Shan State (South) | Kar Li Town | 6 |
| Shan State (South) | Kengtawng Town | 7 |
| Shan State (South) | Kho Lam Town | 6 |
| Shan State (South) | Kunhing Township | 19 |
| Shan State (South) | Kyauktalonegyi Town | 6 |
| Shan State (South) | Kyethi Township | 38 |
| Shan State (South) | Laihka Township | 23 |
| Shan State (South) | Langkho Township | 22 |
| Shan State (South) | Lawksawk Township | 26 |
| Shan State (South) | Loilen Township | 23 |
| Shan State (South) | Mawkmai Township | 15 |
| Shan State (South) | Monghsu Township | 21 |
| Shan State (South) | Mongkaing Township | 29 |
| Shan State (South) | Mongnai Township | 20 |
| Shan State (South) | Mongnawng Town | 5 |
| Shan State (South) | Mongpan Township | 16 |
| Shan State (South) | Mongsan (Hmonesan) Town | 3 |
| Shan State (South) | Nang Pang Town | 4 |
| Shan State (South) | Nansang Township | 25 |
| Shan State (South) | Naungtayar Town | 3 |
| Shan State (South) | Nyaungshwe Township | 42 |
| Shan State (South) | Pawng Lawng Town | 6 |
| Shan State (South) | Pekon Township | 19 |
| Shan State (South) | Pindaya Township | 40 |
| Shan State (South) | Pinlaung Township | 35 |
| Shan State (South) | Shwenyaung Town | 11 |
| Shan State (South) | Taunggyi Township | 46 |
| Shan State (South) | Ywangan Township | 32 |
| Tanintharyi Region | Bokpyin Township | 22 |
| Tanintharyi Region | Dawei Township | 40 |
| Tanintharyi Region | Kaleinaung Town | 4 |
| Tanintharyi Region | Karathuri Town | 3 |
| Tanintharyi Region | Kawthoung Township | 28 |
| Tanintharyi Region | Khamaukgyi Town | 3 |
| Tanintharyi Region | Kyunsu Township | 24 |
| Tanintharyi Region | Launglon Township | 45 |
| Tanintharyi Region | Maw Taung Town | 3 |
| Tanintharyi Region | Myeik Township | 34 |
| Tanintharyi Region | Myitta Town | 3 |
| Tanintharyi Region | Pala Town | 4 |
| Tanintharyi Region | Palauk Town | 4 |
| Tanintharyi Region | Palaw Township | 32 |
| Tanintharyi Region | Pyigyimandaing Town | 3 |
| Tanintharyi Region | Tanintharyi Township | 23 |
| Tanintharyi Region | Thayetchaung Township | 44 |
| Tanintharyi Region | Yebyu Township | 39 |
| Yangon Region | - / Hlaingtharya (West) Township | 15 |
| Yangon Region | - / Hlaingtharya(East) Township | 14 |
| Yangon Region | Ahlone Township | 11 |
| Yangon Region | Ahpyauk Town | 4 |
| Yangon Region | Bahan Township | 22 |
| Yangon Region | Botahtaung Township | 12 |
| Yangon Region | Cocokyun Township | 2 |
| Yangon Region | Dagon Myothit (East) Township | 65 |
| Yangon Region | Dagon Myothit (North) Township | 27 |
| Yangon Region | Dagon Myothit (Seikkan) Township | 39 |
| Yangon Region | Dagon Myothit (South) Township | 49 |
| Yangon Region | Dagon Township | 5 |
| Yangon Region | Dala Township | 47 |
| Yangon Region | Dawbon Township | 14 |
| Yangon Region | Hlaing Township | 16 |
| Yangon Region | Hlegu Township | 59 |
| Yangon Region | Hmawbi Township | 43 |
| Yangon Region | Htantabin Township | 59 |
| Yangon Region | Htaukkyant Town | 13 |
| Yangon Region | Insein Township | 21 |
| Yangon Region | Kamayut Township | 10 |
| Yangon Region | Kawhmu Township | 62 |
| Yangon Region | Kayan Township | 66 |
| Yangon Region | Kungyangon Township | 50 |
| Yangon Region | Kyauktada Township | 9 |
| Yangon Region | Kyauktan Township | 55 |
| Yangon Region | Kyeemyindaing Township | 22 |
| Yangon Region | Lanmadaw Township | 13 |
| Yangon Region | Latha Township | 10 |
| Yangon Region | Mayangone Township | 10 |
| Yangon Region | Mingaladon Township | 19 |
| Yangon Region | Mingalartaungnyunt Township | 20 |
| Yangon Region | North Okkalapa Township | 19 |
| Yangon Region | Okekan Town | 8 |
| Yangon Region | Pabedan Township | 11 |
| Yangon Region | Pazundaung Township | 10 |
| Yangon Region | Sanchaung Township | 18 |
| Yangon Region | Seikgyikanaungto Township | 9 |
| Yangon Region | Shwepyithar Township | 27 |
| Yangon Region | South Okkalapa Township | 13 |
| Yangon Region | Tadar Town | 4 |
| Yangon Region | Taikkyi Township | 83 |
| Yangon Region | Tamwe Township | 20 |
| Yangon Region | Thaketa Township | 19 |
| Yangon Region | Thanlyin Township | 45 |
| Yangon Region | Thingangyun Township | 39 |
| Yangon Region | Thongwa Township | 76 |
| Yangon Region | Twantay Township | 73 |
| Yangon Region | Yankin Township | 15 |

## Foreign polygon dependencies (must be resolved before disable)

| Admin ID | Source | Column | Rows |
|---:|---|---|---:|
| 5985 | core.core_buildings | admin_area_id | 6 |
| 5985 | core.core_places | admin_area_id | 17 |
| 5985 | core.core_settlements | township_id | 3 |
| 5985 | core.core_streets | admin_area_id | 316 |
| 5985 | transport.stops | admin_area_id | 1 |
| 5985 | transport.terminals | admin_area_id | 1 |
| 5986 | core.core_places | admin_area_id | 4 |
| 5986 | core.core_settlements | township_id | 1 |
| 5986 | core.core_streets | admin_area_id | 35 |
| 5986 | transport.stops | admin_area_id | 2 |
| 6675 | core.core_settlements | township_id | 2 |
| 6675 | core.core_streets | admin_area_id | 102 |
| 6675 | transport.stops | admin_area_id | 2 |
| 6675 | transport.terminals | admin_area_id | 1 |
| 6734 | core.core_streets | admin_area_id | 12 |
| 6735 | core.core_places | admin_area_id | 1 |
| 6735 | core.core_settlements | township_id | 7 |
| 6735 | core.core_streets | admin_area_id | 49 |

Foreign-key inventory: 33 constraints reference `core.core_admin_areas`; see the audit source evidence and do not merge/disable until every dependent table is handled.

## Examples by non-empty action

Ten examples are shown for each category that contains at least ten rows; where a category has fewer than ten rows, every available row is shown.

### blocked_missing_legal_geometry

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| district | MMR005D010 |  |  | Kanbalu | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| district | MMR005D011 |  |  | Kawlin | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| self_administered_zone | MMR005S001 |  |  | Naga Self-Administered Zone | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| district | MMR008D001 |  |  | Pyay | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| self_administered_zone | MMR014S001 |  |  | Danu Self-Administered Zone | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| self_administered_zone | MMR014S002 |  |  | Pa-O Self-Administered Zone | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| self_administered_zone | MMR015S001 |  |  | Pa Laung Self-Administered Zone | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| self_administered_zone | MMR015S002 |  |  | Kokang Self-Administered Zone | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| self_administered_zone | MMR015S501 |  |  | Wa Self-Administered Division | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |
| township | MMR006010 |  |  | Bokpyin | No CoreMap or exact-PCode OSM polygon; MIMU geometry is unavailable at this level or restricted to comparison/QA |

### create_missing

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| ward_village_tract | MMR006009701501 |  |  | Shwe Hin Thar Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39155987 |
| ward_village_tract | MMR006009701502 |  |  | Ah Nan War Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39155991 |
| ward_village_tract | MMR006009701503 |  |  | Pi Tauk Shwe War Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39155989 |
| ward_village_tract | MMR006009701504 |  |  | Ba Yint Naung Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39155993 |
| ward_village_tract | MMR006009701505 |  |  | Aung Thu Kha Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39155995 |
| ward_village_tract | MMR006009701506 |  |  | Aye Mya Kan Thar Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39155997 |
| ward_village_tract | MMR006009701507 |  |  | Thi Ri Myaing Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39155999 |
| ward_village_tract | MMR006009701508 |  |  | Shwe Zin Yaw Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39155985 |
| ward_village_tract | MMR006009701509 |  |  | Aye Yeik Nyein Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39156001 |
| ward_village_tract | MMR006009701510 |  |  | Shwe Pyi Thar Ward | No CoreMap match; exact MIMU PCode exists on OSM polygon a39156003 |

### disable_foreign

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| township |  | 5985 | อำเภอเวียงแหง |  | Confirmed foreign polygon; inspect/reassign or exclude all dependencies before disabling |
| township |  | 5986 | อำเภอปางมะผ้า |  | Confirmed foreign polygon; inspect/reassign or exclude all dependencies before disabling |
| township |  | 6675 | Vijoynagar EAC |  | Confirmed foreign polygon; inspect/reassign or exclude all dependencies before disabling |
| township |  | 6734 | S' Bungtlang |  | Confirmed foreign polygon; inspect/reassign or exclude all dependencies before disabling |
| township |  | 6735 | Tipa |  | Confirmed foreign polygon; inspect/reassign or exclude all dependencies before disabling |

### duplicate_merge_candidate

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| ward_village_tract | MMR005001701502 |  |  | Aye Mya Wa Di Ward | Multiple exact CoreMap candidates under the same matched parent: 6849,6853 |
| ward_village_tract | MMR005011701503 |  |  | Ma Har Myaing Ward | Multiple exact CoreMap candidates under the same matched parent: 6794,6797 |
| ward_village_tract | MMR007008701505 |  |  | Gant Gaw Waing Ward | Multiple exact CoreMap candidates under the same matched parent: 5891,5897 |
| ward_village_tract | MMR010005701502 |  |  | Ngwe Taw Kyi Kone Ward | Multiple exact CoreMap candidates under the same matched parent: 6211,6212 |
| ward_village_tract | MMR010018701504 |  |  | Zay Ward | Multiple exact CoreMap candidates under the same matched parent: 6907,6908 |
| ward_village_tract | MMR013018701525 |  |  | No (105) Ward | Multiple exact CoreMap candidates under the same matched parent: 5185,5186 |
| ward_village_tract | MMR013018701526 |  |  | No (106) Ward | Multiple exact CoreMap candidates under the same matched parent: 5182,5183 |
| ward_village_tract | MMR013029701504 |  |  | Taung Bet Paing Ward | Multiple exact CoreMap candidates under the same matched parent: 5113,5119 |
| ward_village_tract | MMR017006701505 |  |  | Myo Ma Ward | Multiple exact CoreMap candidates under the same matched parent: 7262,7269 |
| ward_village_tract | MMR017006702502 |  |  | Myo Ma Ward | Multiple exact CoreMap candidates under the same matched parent: 7262,7269 |

### exact_keep

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| township | MMR009015 | 7114 | ကံမ | Kamma | Identity, parent, official classification and primary bilingual names already match |
| township | MMR011004 | 7482 | သံဖြူဇရပ် | Thanbyuzayat | Identity, parent, official classification and primary bilingual names already match |
| township | MMR011007 | 5053 | သထုံ | Thaton | Identity, parent, official classification and primary bilingual names already match |
| township | MMR012002 | 6987 | ပုဏ္ဏားကျွန်း | Ponnagyun | Identity, parent, official classification and primary bilingual names already match |
| township | MMR016009 | 6390 | တာချီလိတ် | Tachileik | Identity, parent, official classification and primary bilingual names already match |

### manual_review

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| township | MMR006009 |  |  | Kawthoung | Fuzzy-name candidates are review-only: 7444:ကော့သောင်မြို့နယ်:0.947; 7444:ကော့သောင်မြို့နယ်:0.947; 7444:ကော့သောင်မြို့နယ်:0.947 |
| ward_village_tract | MMR001001023 |  |  | Man Kin | Fuzzy-name candidates are review-only: 6656:Man Khein Ward:0.857 |
| ward_village_tract | MMR001001028 |  |  | Nyaung Pin Thar | Fuzzy-name candidates are review-only: 6631:Kyun Pin Thar Ward:0.833 |
| ward_village_tract | MMR001001702501 |  |  | Aye Yar U Ward | Fuzzy-name candidates are review-only: 6595:Aye Yar Ward:0.923 |
| ward_village_tract | MMR001008025 |  |  | In Gyin Kone | Fuzzy-name candidates are review-only: 6651:Nat Gyi Kone Ward:0.800 |
| ward_village_tract | MMR004001701508 |  |  | Zalai Ward | Fuzzy-name candidates are review-only: 6709:Balai Ward:0.800 |
| ward_village_tract | MMR004007023 |  |  | Lungpang | Fuzzy-name candidates are review-only: 6932:Lungvan Ward:0.800 |
| ward_village_tract | MMR005001029 |  |  | Taung Myo | Fuzzy-name candidates are review-only: 6842:တကောင်းရပ်ကွက်:0.833; 6842:တကောင်းရပ်ကွက်:0.833 |
| ward_village_tract | MMR005005012 |  |  | Mya Kan | Fuzzy-name candidates are review-only: 6774:မြကန်သာရပ်ကွက်:0.833; 6774:မြကန်သာရပ်ကွက်:0.833 |
| ward_village_tract | MMR005009011 |  |  | Aung Thar | Fuzzy-name candidates are review-only: 6792:Aung Chan Thar Ward:0.800 |

### reclassify

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| ward_village_tract | MMR005001081 | 6840 | ထုံးဘိုရပ်ကွက် | Htone Bo | Core type/official flags differ from expected village_tract |
| ward_village_tract | MMR006005001 | 7452 | မြိတ်တောင်ရပ်ကွက် | Myeik Taung | Core type/official flags differ from expected village_tract |
| ward_village_tract | MMR009016040 | 7129 | သရက်တော ရပ်ကွက် | Tha Yet Taw | Core type/official flags differ from expected village_tract |
| ward_village_tract | MMR014013005 | 6112 | အမှတ် (၅)ရပ်ကွက် | Ah Hmat (5) | Core type/official flags differ from expected village_tract |
| state_region |  | 6378 | ဝပြည်နယ် တောင်ပိုင်း |  | Core-only Wa/de-facto first-level area must become special_area/reference_only and leave official counts |
| state_region |  | 6485 | ဝပြည်နယ် မြောက်ပိုင်း |  | Core-only Wa/de-facto first-level area must become special_area/reference_only and leave official counts |

### reference_only

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| state_region | MMR007 |  |  | Bago (East) | MIMU GAD status=N/A; excluded from official target |
| state_region | MMR008 |  |  | Bago (West) | MIMU GAD status=N/A; excluded from official target |
| state_region | MMR014 |  |  | Shan (South) | MIMU GAD status=N/A; excluded from official target |
| state_region | MMR015 |  |  | Shan (North) | MIMU GAD status=N/A; excluded from official target |
| state_region | MMR016 |  |  | Shan (East) | MIMU GAD status=N/A; excluded from official target |
| district | MMR015D004 |  |  | Kunlong | MIMU GAD status=Inactive; excluded from official target |
| district | MMR015D005 |  |  | Laukkaing | MIMU GAD status=Inactive; excluded from official target |
| district | MMR015D221 |  |  | Laukkaing (Kokang SAZ) | MIMU GAD status=N/A; excluded from official target |
| district | MMR015D331 |  |  | Mong Maw (Wa SAD) | MIMU GAD status=N/A; excluded from official target |
| district | MMR015D332 |  |  | Wein Kawng (Wein Kao) (Wa SAD) | MIMU GAD status=N/A; excluded from official target |

### update_names

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| state_region | MMR001 | 6667 | ကချင်ပြည်နယ် | Kachin | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR002 | 6007 | ကယားပြည်နယ် | Kayah | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR003 | 5879 | ကရင်ပြည်နယ် | Kayin | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR004 | 6744 | ချင်းပြည်နယ် | Chin | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR005 | 6703 | စစ်ကိုင်းတိုင်းဒေသကြီး | Sagaing | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR006 | 7449 | တနင်္သာရီတိုင်း | Tanintharyi | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR009 | 7027 | မကွေးတိုင်းဒေသကြီး | Magway | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR010 | 6832 | မန္တလေးတိုင်း | Mandalay | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR011 | 5089 | မွန်ပြည်နယ် | Mon | Identity and parent match; MIMU primary English/Myanmar names differ |
| state_region | MMR012 | 6722 | ရခိုင်ပြည်နယ် | Rakhine | Identity and parent match; MIMU primary English/Myanmar names differ |

### update_parent

| Level | PCode | Core ID | Current | Target EN | Reason |
|---|---|---:|---|---|---|
| district | MMR015D006 | 6452 | မိုင်းမော | Hopang | Exact identity match but parent differs from canonical MIMU hierarchy |
| district | MMR015D007 | 6474 | မက်မန်းခရိုင် | Matman | Exact identity match but parent differs from canonical MIMU hierarchy |
| township | MMR001004 | 6666 | တနိုင်းမြို့နယ် | Tanai | Exact identity match but parent differs from canonical MIMU hierarchy |
| township | MMR001005 | 6690 | ချီဖွေမြို့နယ် | Chipwi | Exact identity match but parent differs from canonical MIMU hierarchy |
| township | MMR001006 | 6688 | ဆော့လော်မြို့နယ် | Tsawlaw | Exact identity match but parent differs from canonical MIMU hierarchy |
| township | MMR002002 | 6015 | ဒီးမော့ဆိုမြို့နယ် | Demoso | Exact identity match but parent differs from canonical MIMU hierarchy |
| township | MMR002003 | 6013 | ဖရူဆိုမြို့နယ် | Hpruso | Exact identity match but parent differs from canonical MIMU hierarchy |
| township | MMR002007 | 5962 | မယ်စဲ့မြို့နယ် | Mese | Exact identity match but parent differs from canonical MIMU hierarchy |
| township | MMR003004 | 6018 | သံတောင်ကြီးမြို့နယ် | Thandaunggyi | Exact identity match but parent differs from canonical MIMU hierarchy |
| township | MMR003007 | 7502 | ကြာအင်းဆိပ်ကြီးမြို့နယ် | Kyainseikgyi | Exact identity match but parent differs from canonical MIMU hierarchy |

## Stop gate

Phase 2 has not run. Review the action counts, duplicate decisions, fuzzy/manual candidates, blocked geometry rows, and foreign dependency plan before approving any migration or production data change.
