# Admin reconciliation manifests - Phase 1

Report-only regeneration. No production writes. No migration created.

- MIMU workbook: `infrastructure/tiles/data/mimu/pcodes/Myanmar_PCodes_Release_9.7_Jan2026_StRgn_Dist_Tsp_Town_Ward_VT.xlsm`
- Core areas snapshot: `/private/tmp/coremap-admin-audit.r55Hzm/core_areas.csv`
- Postal ZIP: `/Users/nyihtet/Downloads/Complete Data.zip`
- Matching order: parent -> bilingual/alias -> normalized MY -> normalized EN -> spatial support -> fuzzy review-only

## Hard validations

| Check | Value | Pass |
|---|---:|---|
| Source rows accounted for | 18037/18037 | yes |
| Official township identities | 330 | yes |
| Unresolved duplicate create actions remaining | 0 | yes |
| Duplicate create path groups converted to manual_review | 155 | yes |
| Valid unique postal codes | 17297 | yes |
| Postal actions accounted for | 17297/17297 | yes |
| Matched rows preserve existing geom | True | yes |

## Actions by hierarchy level

### state_region (n=20)

| Action | Count |
|---|---:|
| create_mimu_placeholder | 1 |
| mark_reference_only | 5 |
| update_name | 14 |

### self_administered_zone (n=6)

| Action | Count |
|---|---:|
| create_mimu_placeholder | 6 |

### district (n=82)

| Action | Count |
|---|---:|
| create_mimu_placeholder | 19 |
| manual_review | 3 |
| mark_reference_only | 5 |
| update_name | 55 |

### township (n=358)

| Action | Count |
|---|---:|
| create_mimu_placeholder | 46 |
| keep_existing | 10 |
| manual_review | 3 |
| mark_reference_only | 28 |
| update_name | 234 |
| update_name_and_parent | 37 |

### ward_village_tract (n=17571)

| Action | Count |
|---|---:|
| create_mimu_placeholder | 15082 |
| manual_review | 358 |
| mark_reference_only | 502 |
| update_name | 1625 |
| update_type | 4 |

## Official target townships (330)

Official Active township source rows: **330**.

| # | Source key | EN | MY | Action | CoreMap ID | Confidence | Preserve geom |
|---:|---|---|---|---|---:|---:|---|
| 1 | 03_Township:80 | Myitkyina | မြစ်ကြီးနား | update_name | 6610 | 95 | True |
| 2 | 03_Township:87 | Waingmaw | ဝိုင်းမော် | update_name | 6623 | 95 | True |
| 3 | 03_Township:73 | Injangyang | အင်ဂျန်းယန် | update_name | 6668 | 95 | True |
| 4 | 03_Township:85 | Tanai | တနိုင်း | update_name_and_parent | 6666 | 95 | True |
| 5 | 03_Township:71 | Chipwi | ချီ​ဖွေ | update_name_and_parent | 6690 | 95 | True |
| 6 | 03_Township:86 | Tsawlaw | ဆော့လော် | update_name_and_parent | 6688 | 95 | True |
| 7 | 03_Township:78 | Mohnyin | မိုးညှင်း | update_name | 6601 | 95 | True |
| 8 | 03_Township:77 | Mogaung | မိုးကောင်း | update_name | 6660 | 95 | True |
| 9 | 03_Township:72 | Hpakant | ဖားကန့် | update_name | 6664 | 95 | True |
| 10 | 03_Township:70 | Bhamo | ဗန်းမော် | update_name | 6612 | 95 | True |
| 11 | 03_Township:83 | Shwegu | ရွှေကူ | update_name | 6589 | 95 | True |
| 12 | 03_Township:79 | Momauk | မိုးမောက် | update_name | 6593 | 95 | True |
| 13 | 03_Township:76 | Mansi | မံစီ | update_name | 6584 | 95 | True |
| 14 | 03_Township:82 | Puta-O | ပူတာအို | update_name | 6685 | 95 | True |
| 15 | 03_Township:84 | Sumprabum | ဆွမ်ပရာဘွမ် | update_name | 6669 | 95 | True |
| 16 | 03_Township:75 | Machanbaw | မချမ်းဘော | update_name | 6686 | 95 | True |
| 17 | 03_Township:81 | Nawngmun | နောင်မွန်း | update_name | 6681 | 95 | True |
| 18 | 03_Township:74 | Khaunglanhpu | ခေါင်လန်ဖူး | update_name | 6687 | 95 | True |
| 19 | 03_Township:92 | Loikaw | လွိုင်ကော် | update_name | 5997 | 95 | True |
| 20 | 03_Township:89 | Demoso | ဒီးမော့ဆို | update_name_and_parent | 6015 | 95 | True |
| 21 | 03_Township:91 | Hpruso | ဖရူဆို | update_name_and_parent | 6013 | 95 | True |
| 22 | 03_Township:94 | Shadaw | ရှားတော | update_name | 5998 | 95 | True |
| 23 | 03_Township:88 | Bawlake | ဘောလခဲ | create_mimu_placeholder |  | 100 | False |
| 24 | 03_Township:90 | Hpasawng | ဖားဆောင်း | update_name | 5972 | 95 | True |
| 25 | 03_Township:93 | Mese | မယ်စဲ့ | update_name | 5962 | 95 | True |
| 26 | 03_Township:96 | Hpa-An | ဘားအံ | update_name | 5877 | 95 | True |
| 27 | 03_Township:95 | Hlaingbwe | လှိုင်းဘွဲ့ | update_name | 5880 | 95 | True |
| 28 | 03_Township:97 | Hpapun | ဖာပွန် | update_name | 5978 | 95 | True |
| 29 | 03_Township:101 | Thandaunggyi | သံတောင်ကြီး | update_name_and_parent | 6018 | 95 | True |
| 30 | 03_Township:100 | Myawaddy | မြဝတီ | update_name | 5033 | 95 | True |
| 31 | 03_Township:98 | Kawkareik | ကော့ကရိတ် | update_name | 5030 | 95 | True |
| 32 | 03_Township:99 | Kyainseikgyi | ကြာအင်းဆိပ်ကြီး | update_name_and_parent | 7502 | 95 | True |
| 33 | 03_Township:61 | Falam | ဖလမ်း | update_name | 6739 | 95 | True |
| 34 | 03_Township:62 | Hakha | ဟားခါး | update_name | 6743 | 95 | True |
| 35 | 03_Township:68 | Thantlang | ထန်တလန် | update_name | 6745 | 95 | True |
| 36 | 03_Township:67 | Tedim | တီးတိန် | update_name_and_parent | 6718 | 95 | True |
| 37 | 03_Township:69 | Tonzang | တွန်းဇန် | update_name_and_parent | 6712 | 95 | True |
| 38 | 03_Township:65 | Mindat | မင်းတပ် | update_name | 6943 | 95 | True |
| 39 | 03_Township:64 | Matupi | မတူပီ | update_name | 6922 | 95 | True |
| 40 | 03_Township:63 | Kanpetlet | ကန်ပက်လက် | update_name | 6949 | 95 | True |
| 41 | 03_Township:66 | Paletwa | ပလက်ဝ | update_name_and_parent | 6941 | 95 | True |
| 42 | 03_Township:216 | Sagaing | စစ်ကိုင်း | update_name | 6831 | 95 | True |
| 43 | 03_Township:211 | Myinmu | မြင်းမူ | update_name | 6829 | 95 | True |
| 44 | 03_Township:210 | Myaung | မြောင် | update_name | 6875 | 95 | True |
| 45 | 03_Township:218 | Shwebo | ရွှေဘို | update_name | 6786 | 95 | True |
| 46 | 03_Township:203 | Khin-U | ခင်ဦး | update_name | 6783 | 95 | True |
| 47 | 03_Township:223 | Wetlet | ဝက်လက် | update_name | 6828 | 95 | True |
| 48 | 03_Township:199 | Kanbalu | ကန့်ဘလူ | update_name | 6762 | 95 | True |
| 49 | 03_Township:204 | Kyunhla | ကျွန်းလှ | update_name | 5023 | 95 | True |
| 50 | 03_Township:225 | Ye-U | ရေဦး | update_name | 6789 | 95 | True |
| 51 | 03_Township:219 | Tabayin | ဒီပဲယင်း | update_name | 6788 | 95 | True |
| 52 | 03_Township:221 | Taze | တန့်ဆည် | update_name_and_parent | 6766 | 95 | True |
| 53 | 03_Township:209 | Monywa | မုံရွာ | update_name | 6822 | 95 | True |
| 54 | 03_Township:192 | Budalin | ဘုတလင် | update_name | 6824 | 95 | True |
| 55 | 03_Township:190 | Ayadaw | အရာတော် | update_name | 6825 | 95 | True |
| 56 | 03_Township:193 | Chaung-U | ချောင်းဦး | update_name | 6862 | 95 | True |
| 57 | 03_Township:226 | Yinmarbin | ယင်းမာပင် | update_name | 6816 | 95 | True |
| 58 | 03_Township:200 | Kani | ကနီ | update_name | 6805 | 95 | True |
| 59 | 03_Township:217 | Salingyi | ဆားလင်းကြီး | update_name | 6872 | 95 | True |
| 60 | 03_Township:213 | Pale | ပုလဲ | update_name | 6814 | 95 | True |
| 61 | 03_Township:201 | Katha | ကသာ | update_name | 6588 | 95 | True |
| 62 | 03_Township:196 | Indaw | အင်းတော် | update_name | 6607 | 95 | True |
| 63 | 03_Township:222 | Tigyaing | ထီးချိုင့် | update_name | 6587 | 95 | True |
| 64 | 03_Township:191 | Banmauk | ဗန်းမောက် | update_name | 6702 | 95 | True |
| 65 | 03_Township:202 | Kawlin | ကောလင်း | update_name | 6761 | 95 | True |
| 66 | 03_Township:224 | Wuntho | ဝန်းသို | update_name | 6706 | 95 | True |
| 67 | 03_Township:215 | Pinlebu | ပင်လည်ဘူး | update_name | 6707 | 95 | True |
| 68 | 03_Township:197 | Kale | ကလေး | update_name | 6741 | 95 | True |
| 69 | 03_Township:198 | Kalewa | ကလေးဝ | update_name | 6742 | 95 | True |
| 70 | 03_Township:208 | Mingin | မင်းကင်း | update_name | 6798 | 95 | True |
| 71 | 03_Township:220 | Tamu | တမူး | update_name | 6726 | 95 | True |
| 72 | 03_Township:207 | Mawlaik | မော်လိုက် | update_name | 5022 | 95 | True |
| 73 | 03_Township:214 | Paungbyin | ဖောင်းပြင် | update_name | 6715 | 95 | True |
| 74 | 03_Township:194 | Hkamti | ခန္တီး | update_name | 6694 | 95 | True |
| 75 | 03_Township:195 | Homalin | ဟုမ္မလင်း | update_name | 6701 | 95 | True |
| 76 | 03_Township:206 | Layshi | လေရှီး | update_name | 6699 | 95 | True |
| 77 | 03_Township:205 | Lahe | လဟယ် | update_name | 6692 | 95 | True |
| 78 | 03_Township:212 | Nanyun | နန်းယွန်း | create_mimu_placeholder |  | 100 | False |
| 79 | 03_Township:309 | Dawei | ထားဝယ် | update_name | 7470 | 95 | True |
| 80 | 03_Township:312 | Launglon | လောင်းလုံး | update_name | 7481 | 95 | True |
| 81 | 03_Township:316 | Thayetchaung | သရက်ချောင်း | update_name | 7471 | 95 | True |
| 82 | 03_Township:317 | Yebyu | ရေဖြူ | update_name | 7503 | 95 | True |
| 83 | 03_Township:313 | Myeik | မြိတ် | update_name | 7465 | 95 | True |
| 84 | 03_Township:311 | Kyunsu | ကျွန်းစု | update_name | 7439 | 95 | True |
| 85 | 03_Township:314 | Palaw | ပုလော | update_name | 7469 | 95 | True |
| 86 | 03_Township:315 | Tanintharyi | တနင်္သာရီ | update_name | 7468 | 95 | True |
| 87 | 03_Township:310 | Kawthoung | ကော့သောင်း | manual_review |  | 95 | True |
| 88 | 03_Township:308 | Bokpyin | ဘုတ်ပြင်း | update_name_and_parent | 5035 | 95 | True |
| 89 | 03_Township:33 | Bago | ပဲခူး | update_name | 5924 | 95 | True |
| 90 | 03_Township:44 | Thanatpin | သနပ်ပင် | update_name | 5865 | 95 | True |
| 91 | 03_Township:36 | Kawa | ကဝ | update_name | 5873 | 95 | True |
| 92 | 03_Township:45 | Waw | ဝေါ | update_name | 5922 | 95 | True |
| 93 | 03_Township:39 | Nyaunglebin | ညောင်လေးပင် | update_name | 5910 | 95 | True |
| 94 | 03_Township:38 | Kyauktaga | ကျောက်တံခါး | update_name | 5925 | 95 | True |
| 95 | 03_Township:34 | Daik-U | ဒိုက်ဦး | update_name | 5911 | 95 | True |
| 96 | 03_Township:42 | Shwegyin | ရွှေကျင် | update_name | 5920 | 95 | True |
| 97 | 03_Township:43 | Taungoo | တောင်ငူ | update_name | 6019 | 95 | True |
| 98 | 03_Township:46 | Yedashe | ရေတာရှည် | update_name | 6020 | 95 | True |
| 99 | 03_Township:37 | Kyaukkyi | ကျောက်ကြီး | update_name | 5941 | 95 | True |
| 100 | 03_Township:41 | Phyu | ဖြူး | update_name | 5942 | 95 | True |
| 101 | 03_Township:40 | Oktwin | အုတ်တွင်း | update_name | 5943 | 95 | True |
| 102 | 03_Township:35 | Htantabin | ထန်းတပင် | update_name | 5971 | 95 | True |
| 103 | 03_Township:56 | Pyay | ပြည် | create_mimu_placeholder |  | 100 | False |
| 104 | 03_Township:54 | Paukkhaung | ပေါက်ခေါင်း | update_name | 7137 | 95 | True |
| 105 | 03_Township:53 | Padaung | ပန်းတောင်း | create_mimu_placeholder |  | 100 | False |
| 106 | 03_Township:55 | Paungde | ပေါင်းတည် | update_name | 7161 | 95 | True |
| 107 | 03_Township:59 | Thegon | သဲကုန်း | update_name | 7157 | 95 | True |
| 108 | 03_Township:57 | Shwedaung | ရွှေတောင် | create_mimu_placeholder |  | 100 | False |
| 109 | 03_Township:58 | Thayarwady | သာယာဝတီ | update_name | 7232 | 95 | True |
| 110 | 03_Township:48 | Letpadan | လက်ပံတန်း | update_name | 7225 | 95 | True |
| 111 | 03_Township:49 | Minhla | မင်းလှ | update_name | 7224 | 95 | True |
| 112 | 03_Township:52 | Okpho | အုတ်ဖို | update_name | 7168 | 95 | True |
| 113 | 03_Township:60 | Zigon | ဇီးကုန်း | update_name | 7162 | 95 | True |
| 114 | 03_Township:51 | Nattalin | နတ်တလင်း | update_name | 7160 | 95 | True |
| 115 | 03_Township:50 | Monyo | မိုးညို | update_name | 7171 | 95 | True |
| 116 | 03_Township:47 | Gyobingauk | ကြို့ပင်ကောက် | update_name | 7163 | 95 | True |
| 117 | 03_Township:106 | Magway | မကွေး | update_name | 7072 | 95 | True |
| 118 | 03_Township:125 | Yenangyaung | ရေနံချောင်း | update_name | 7028 | 95 | True |
| 119 | 03_Township:103 | Chauk | ချောက် | update_name | 7031 | 95 | True |
| 120 | 03_Township:122 | Taungdwingyi | တောင်တွင်းကြီး | update_name | 7076 | 95 | True |
| 121 | 03_Township:111 | Myothit | မြို့သစ် | update_name | 7071 | 95 | True |
| 122 | 03_Township:112 | Natmauk | နတ်မောက် | update_name | 7038 | 95 | True |
| 123 | 03_Township:107 | Minbu | မင်းဘူး | manual_review |  | 82 | True |
| 124 | 03_Township:116 | Pwintbyu | ပွင့်ဖြူ | update_name | 7024 | 95 | True |
| 125 | 03_Township:113 | Ngape | ငဖဲ | update_name | 7096 | 95 | True |
| 126 | 03_Township:117 | Salin | စလင်း | update_name | 7033 | 95 | True |
| 127 | 03_Township:120 | Sidoktaya | စေတုတ္ထရာ | manual_review |  | 89 | True |
| 128 | 03_Township:123 | Thayet | သရက် | update_name | 7127 | 95 | True |
| 129 | 03_Township:109 | Minhla | မင်းလှ | create_mimu_placeholder |  | 100 | False |
| 130 | 03_Township:108 | Mindon | မင်းတုန်း | update_name | 7107 | 95 | True |
| 131 | 03_Township:105 | Kamma | ကံမ | keep_existing | 7114 | 100 | True |
| 132 | 03_Township:102 | Aunglan | အောင်လံ | update_name | 7123 | 95 | True |
| 133 | 03_Township:121 | Sinbaungwe | ဆင်ပေါင်ဝဲ | update_name | 7081 | 95 | True |
| 134 | 03_Township:114 | Pakokku | ပခုက္ကူ | update_name | 6914 | 95 | True |
| 135 | 03_Township:126 | Yesagyo | ရေစကြို | update_name | 6883 | 95 | True |
| 136 | 03_Township:110 | Myaing | မြိုင် | update_name | 6931 | 95 | True |
| 137 | 03_Township:115 | Pauk | ပေါက် | update_name | 6929 | 95 | True |
| 138 | 03_Township:119 | Seikphyu | ဆိပ်ဖြူ | update_name | 6916 | 95 | True |
| 139 | 03_Township:104 | Gangaw | ဂန့်ဂေါ | update_name | 6809 | 95 | True |
| 140 | 03_Township:124 | Tilin | ထီးလင်း | update_name | 6927 | 95 | True |
| 141 | 03_Township:118 | Saw | ဆော | update_name | 6926 | 95 | True |
| 142 | 03_Township:128 | Aungmyaythazan | အောင်မြေသာစံ | update_name | 6535 | 95 | True |
| 143 | 03_Township:129 | Chanayethazan | ချမ်းအေးသာစံ | update_name | 6237 | 95 | True |
| 144 | 03_Township:134 | Mahaaungmyay | မဟာအောင်မြေ | update_name | 6259 | 95 | True |
| 145 | 03_Township:130 | Chanmyathazi | ချမ်းမြသာစည် | update_name | 6223 | 95 | True |
| 146 | 03_Township:145 | Pyigyitagon | ပြည်ကြီးတံခွန် | update_name | 6203 | 95 | True |
| 147 | 03_Township:127 | Amarapura | အမရပူရ | update_name | 6202 | 95 | True |
| 148 | 03_Township:143 | Patheingyi | ပုသိမ်ကြီး | update_name | 6276 | 95 | True |
| 149 | 03_Township:146 | Pyinoolwin | ပြင်ဦးလွင် | update_name | 6536 | 95 | True |
| 150 | 03_Township:133 | Madaya | မတ္တရာ | update_name_and_parent | 6544 | 95 | True |
| 151 | 03_Township:147 | Singu | စဉ့်ကူး | update_name_and_parent | 6550 | 95 | True |
| 152 | 03_Township:137 | Mogoke | မိုးကုတ် | update_name_and_parent | 6553 | 95 | True |
| 153 | 03_Township:151 | Thabeikkyin | သပိတ်ကျင်း | update_name_and_parent | 6554 | 95 | True |
| 154 | 03_Township:132 | Kyaukse | ကျောက်ဆည် | update_name | 6198 | 95 | True |
| 155 | 03_Township:148 | Sintgaing | စဉ့်ကိုင် | update_name | 6205 | 95 | True |
| 156 | 03_Township:139 | Myittha | မြစ်သား | update_name | 6200 | 95 | True |
| 157 | 03_Township:149 | Tada-U | တံတားဦး | update_name_and_parent | 6891 | 95 | True |
| 158 | 03_Township:138 | Myingyan | မြင်းခြံ | update_name | 6888 | 95 | True |
| 159 | 03_Township:150 | Taungtha | တောင်သာ | update_name | 6903 | 95 | True |
| 160 | 03_Township:140 | Natogyi | နွားထိုးကြီး | update_name | 6892 | 95 | True |
| 161 | 03_Township:131 | Kyaukpadaung | ကျောက်ပန်းတောင်း | update_name | 7050 | 95 | True |
| 162 | 03_Township:141 | Ngazun | ငါန်းဇွန် | update_name_and_parent | 6857 | 95 | True |
| 163 | 03_Township:142 | Nyaung-U | ညောင်ဦး | update_name | 6905 | 95 | True |
| 164 | 03_Township:154 | Yamethin | ရမည်းသင်း | update_name | 6069 | 95 | True |
| 165 | 03_Township:144 | Pyawbwe | ပျော်ဘွယ် | update_name | 7052 | 95 | True |
| 166 | 03_Township:136 | Meiktila | မိတ္ထီလာ | update_name | 7051 | 95 | True |
| 167 | 03_Township:135 | Mahlaing | မလှိုင် | update_name | 6898 | 95 | True |
| 168 | 03_Township:152 | Thazi | သာစည် | update_name | 6164 | 95 | True |
| 169 | 03_Township:153 | Wundwin | ဝမ်းတွင်း | update_name | 6185 | 95 | True |
| 170 | 03_Township:159 | Mawlamyine | မော်လမြိုင် | update_name | 5070 | 95 | True |
| 171 | 03_Township:157 | Kyaikmaraw | ကျိုက်မရော | update_name | 5098 | 95 | True |
| 172 | 03_Township:156 | Chaungzon | ချောင်းဆုံ | update_name | 5110 | 95 | True |
| 173 | 03_Township:162 | Thanbyuzayat | သံဖြူဇရပ် | keep_existing | 7482 | 100 | True |
| 174 | 03_Township:160 | Mudon | မုဒုံ | update_name | 5108 | 95 | True |
| 175 | 03_Township:164 | Ye | ရေး | update_name_and_parent | 7491 | 95 | True |
| 176 | 03_Township:163 | Thaton | သထုံ | keep_existing | 5053 | 100 | True |
| 177 | 03_Township:161 | Paung | ပေါင် | update_name | 5055 | 95 | True |
| 178 | 03_Township:158 | Kyaikto | ကျိုက်ထို | update_name_and_parent | 5889 | 95 | True |
| 179 | 03_Township:155 | Bilin | ဘီးလင်း | update_name_and_parent | 5881 | 95 | True |
| 180 | 03_Township:187 | Sittwe | စစ်တွေ | update_name | 6993 | 95 | True |
| 181 | 03_Township:184 | Ponnagyun | ပုဏ္ဏားကျွန်း | keep_existing | 6987 | 100 | True |
| 182 | 03_Township:180 | Mrauk-U | မြောက်ဦး | update_name | 6951 | 95 | True |
| 183 | 03_Township:177 | Kyauktaw | ကျောက်တော် | update_name | 6960 | 95 | True |
| 184 | 03_Township:179 | Minbya | မင်းပြား | update_name | 6950 | 95 | True |
| 185 | 03_Township:182 | Myebon | မြေပုံ | update_name | 6897 | 95 | True |
| 186 | 03_Township:183 | Pauktaw | ပေါက်တော | update_name | 7000 | 95 | True |
| 187 | 03_Township:186 | Rathedaung | ရသေ့တောင် | update_name | 6986 | 95 | True |
| 188 | 03_Township:178 | Maungdaw | မောင်တော | update_name | 6966 | 95 | True |
| 189 | 03_Township:174 | Buthidaung | ဘူးသီးတောင် | update_name | 6965 | 95 | True |
| 190 | 03_Township:176 | Kyaukpyu | ကျောက်ဖြူ | update_name | 5199 | 95 | True |
| 191 | 03_Township:181 | Munaung | မာန်အောင် | update_name_and_parent | 5091 | 95 | True |
| 192 | 03_Township:185 | Ramree | ရမ်းဗြဲ | update_name | 7184 | 95 | True |
| 193 | 03_Township:173 | Ann | အမ်း | update_name_and_parent | 7098 | 95 | True |
| 194 | 03_Township:188 | Thandwe | သံတွဲ | update_name | 7176 | 95 | True |
| 195 | 03_Township:189 | Toungup | တောင်ကုတ် | update_name_and_parent | 7109 | 95 | True |
| 196 | 03_Township:175 | Gwa | ဂွ | update_name | 7188 | 95 | True |
| 197 | 03_Township:334 | Insein | အင်းစိန် | keep_existing | 5690 | 100 | True |
| 198 | 03_Township:345 | Mingaladon | မင်္ဂလာဒုံ | update_name | 5801 | 95 | True |
| 199 | 03_Township:332 | Hmawbi | မှော်ဘီ | update_name | 5856 | 95 | True |
| 200 | 03_Township:331 | Hlegu | လှည်းကူး | update_name | 5857 | 95 | True |
| 201 | 03_Township:355 | Taikkyi | တိုက်ကြီး | update_name | 7233 | 95 | True |
| 202 | 03_Township:333 | Htantabin | ထန်းတပင် | update_name | 7298 | 95 | True |
| 203 | 03_Township:353 | Shwepyithar | ရွှေပြည်သာ | update_name | 5808 | 95 | True |
| 204 | 03_Township:359 | Thingangyun | သင်္ဃန်းကျွန်း | keep_existing | 5344 | 100 | True |
| 205 | 03_Township:362 | Yankin | ရန်ကင်း | update_name | 5289 | 95 | True |
| 206 | 03_Township:354 | South Okkalapa | တောင်ဥက္ကလာပ | update_name | 5267 | 95 | True |
| 207 | 03_Township:347 | North Okkalapa | မြောက်ဥက္ကလာပ | keep_existing | 5772 | 100 | True |
| 208 | 03_Township:357 | Thaketa | သာကေတ | update_name | 5388 | 95 | True |
| 209 | 03_Township:328 | Dawbon | ဒေါပုံ | keep_existing | 5395 | 100 | True |
| 210 | 03_Township:356 | Tamwe | တာမွေ | update_name | 5568 | 95 | True |
| 211 | 03_Township:349 | Pazundaung | ပုဇွန်တောင် | update_name | 5425 | 95 | True |
| 212 | 03_Township:320 | Botahtaung | ဗိုလ်တထောင် | update_name | 5446 | 95 | True |
| 213 | 03_Township:326 | Dagon Myothit (South) | ဒဂုံမြို့သစ် (တောင်ပိုင်း) | update_name | 5231 | 95 | True |
| 214 | 03_Township:324 | Dagon Myothit (North) | ဒဂုံမြို့သစ် (မြောက်ပိုင်း) | update_name | 5722 | 95 | True |
| 215 | 03_Township:323 | Dagon Myothit (East) | ဒဂုံမြို့သစ် (အရှေ့ပိုင်း) | update_name | 5165 | 95 | True |
| 216 | 03_Township:325 | Dagon Myothit (Seikkan) | ဒဂုံမြို့သစ် (ဆိပ်ကမ်း) | create_mimu_placeholder |  | 100 | False |
| 217 | 03_Township:346 | Mingalartaungnyunt | မင်္ဂလာတောင်ညွန့် | update_name | 5538 | 95 | True |
| 218 | 03_Township:358 | Thanlyin | သန်လျင် | update_name | 5211 | 95 | True |
| 219 | 03_Township:340 | Kyauktan | ကျောက်တန်း | update_name | 5144 | 95 | True |
| 220 | 03_Township:360 | Thongwa | သုံးခွ | update_name | 5145 | 95 | True |
| 221 | 03_Township:337 | Kayan | ခရမ်း | update_name | 5142 | 95 | True |
| 222 | 03_Township:361 | Twantay | တွံတေး | update_name | 7300 | 95 | True |
| 223 | 03_Township:336 | Kawhmu | ကော့မှူး | update_name | 5125 | 95 | True |
| 224 | 03_Township:338 | Kungyangon | ကွမ်းခြံကုန်း | update_name | 5112 | 95 | True |
| 225 | 03_Township:327 | Dala | ဒလ | update_name | 5133 | 95 | True |
| 226 | 03_Township:351 | Seikgyikanaungto | ဆိပ်ကြီး/ခနောင်တို | update_name | 5612 | 95 | True |
| 227 | 03_Township:321 | Cocokyun | ကိုကိုးကျွန်း | update_name | 7440 | 95 | True |
| 228 | 03_Township:339 | Kyauktada | ကျောက်တံတား | update_name | 5430 | 95 | True |
| 229 | 03_Township:348 | Pabedan | ပန်းဘဲတန်း | update_name | 5481 | 95 | True |
| 230 | 03_Township:342 | Lanmadaw | လမ်းမတော် | update_name | 5476 | 95 | True |
| 231 | 03_Township:343 | Latha | လသာ | update_name | 5467 | 95 | True |
| 232 | 03_Township:318 | Ahlone | အလုံ | update_name | 5494 | 95 | True |
| 233 | 03_Township:341 | Kyeemyindaing | ကြည့်မြင်တိုင် | update_name | 5596 | 95 | True |
| 234 | 03_Township:350 | Sanchaung | စမ်းချောင်း | update_name | 5586 | 95 | True |
| 235 | 03_Township:329 | Hlaing | လှိုင် | update_name | 5647 | 95 | True |
| 236 | 03_Township:335 | Kamaryut | ကမာရွတ် | update_name | 5306 | 95 | True |
| 237 | 03_Township:344 | Mayangone | မရမ်းကုန်း | update_name | 5253 | 95 | True |
| 238 | 03_Township:322 | Dagon | ဒဂုံ | keep_existing | 5505 | 100 | True |
| 239 | 03_Township:319 | Bahan | ဗဟန်း | update_name | 5565 | 95 | True |
| 240 | 03_Township:363 | Hlaingtharya (East) | လှိုင်သာယာ (အရှေ့ပိုင်း) | update_name | 5659 | 95 | True |
| 241 | 03_Township:364 | Hlaingtharya (West) | လှိုင်သာယာ (အနောက်ပိုင်း) | update_name | 5675 | 95 | True |
| 242 | 03_Township:306 | Taunggyi | တောင်ကြီး | update_name | 6114 | 95 | True |
| 243 | 03_Township:302 | Nyaungshwe | ညောင်ရွှေ | update_name_and_parent | 6076 | 95 | True |
| 244 | 03_Township:287 | Hopong | ဟိုပုံး | update_name | 6310 | 95 | True |
| 245 | 03_Township:288 | Hsihseng | ဆီဆိုင် | update_name | 6410 | 95 | True |
| 246 | 03_Township:289 | Kalaw | ကလော | update_name_and_parent | 6160 | 95 | True |
| 247 | 03_Township:304 | Pindaya | ပင်းတယ | update_name | 6144 | 95 | True |
| 248 | 03_Township:307 | Ywangan | ရွာငံ | create_mimu_placeholder |  | 100 | False |
| 249 | 03_Township:294 | Lawksawk | ရပ်စောက် | update_name | 6280 | 95 | True |
| 250 | 03_Township:305 | Pinlaung | ပင်လောင်း | create_mimu_placeholder |  | 100 | False |
| 251 | 03_Township:303 | Pekon | ဖယ်ခုံ | update_name_and_parent | 6039 | 95 | True |
| 252 | 03_Township:295 | Loilen | လွိုင်လင် | update_name | 6126 | 95 | True |
| 253 | 03_Township:292 | Laihka | လဲချား | update_name | 6305 | 95 | True |
| 254 | 03_Township:301 | Nansang | နမ့်စန် | update_name_and_parent | 6108 | 95 | True |
| 255 | 03_Township:290 | Kunhing | ကွန်ဟိန်း | update_name_and_parent | 6313 | 95 | True |
| 256 | 03_Township:291 | Kyethi | ကျေးသီး | update_name_and_parent | 6322 | 95 | True |
| 257 | 03_Township:298 | Mongkaing | မိုင်းကိုင် | update_name | 6290 | 95 | True |
| 258 | 03_Township:297 | Monghsu | မိုင်းရှူး | update_name_and_parent | 6327 | 95 | True |
| 259 | 03_Township:293 | Langkho | လင်းခေး | update_name | 6093 | 95 | True |
| 260 | 03_Township:299 | Mongnai | မိုးနဲ | update_name_and_parent | 6362 | 95 | True |
| 261 | 03_Township:296 | Mawkmai | မောက်မယ် | update_name | 6092 | 95 | True |
| 262 | 03_Township:300 | Mongpan | မိုင်းပန် | update_name | 6333 | 95 | True |
| 263 | 03_Township:256 | Lashio | လားရှိုး | create_mimu_placeholder |  | 100 | False |
| 264 | 03_Township:247 | Hseni | သိန္နီ | create_mimu_placeholder |  | 100 | False |
| 265 | 03_Township:268 | Mongyai | မိုင်းရယ် | update_name | 6479 | 95 | True |
| 266 | 03_Township:284 | Tangyan | တန့်ယန်း | update_name | 6467 | 95 | True |
| 267 | 03_Township:282 | Pangsang (Panghkam) | ပန်ဆန်း (ပန်ခမ်း) | create_mimu_placeholder |  | 100 | False |
| 268 | 03_Township:277 | Narphan | နားဖန်း | create_mimu_placeholder |  | 100 | False |
| 269 | 03_Township:283 | Pangwaun | ပန်ဝိုင် | create_mimu_placeholder |  | 100 | False |
| 270 | 03_Township:266 | Mongmao | မိုင်းမော | create_mimu_placeholder |  | 100 | False |
| 271 | 03_Township:269 | Muse | မူဆယ် | update_name | 6600 | 95 | True |
| 272 | 03_Township:272 | Namhkan | နမ့်ခမ်း | update_name | 6599 | 95 | True |
| 273 | 03_Township:254 | Kutkai | ကွတ်ခိုင် | update_name | 6569 | 95 | True |
| 274 | 03_Township:255 | Kyaukme | ကျောက်မဲ | update_name | 6551 | 95 | True |
| 275 | 03_Township:279 | Nawnghkio | နောင်ချို | update_name | 6524 | 95 | True |
| 276 | 03_Township:248 | Hsipaw | သီပေါ | update_name | 6523 | 95 | True |
| 277 | 03_Township:274 | Namtu | နမ္မတူ | update_name_and_parent | 6560 | 95 | True |
| 278 | 03_Township:273 | Namhsan | နမ့်ဆန် | update_name | 6394 | 95 | True |
| 279 | 03_Township:267 | Mongmit | မိုးမိတ် | update_name | 6558 | 95 | True |
| 280 | 03_Township:261 | Mabein | မဘိမ်း | update_name | 6585 | 95 | True |
| 281 | 03_Township:264 | Manton | မန်တုံ | update_name | 6527 | 95 | True |
| 282 | 03_Township:253 | Kunlong | ကွမ်းလုံ | update_name | 6441 | 95 | True |
| 283 | 03_Township:245 | Hopang | ဟိုပန် | create_mimu_placeholder |  | 100 | False |
| 284 | 03_Township:257 | Laukkaing | လောက်ကိုင် | update_name | 6417 | 95 | True |
| 285 | 03_Township:251 | Konkyan | ကုန်းကြမ်း | create_mimu_placeholder |  | 100 | False |
| 286 | 03_Township:265 | Matman | မက်မန်း | create_mimu_placeholder |  | 100 | False |
| 287 | 03_Township:228 | Kengtung | ကျိုင်းတုံ | update_name | 6360 | 95 | True |
| 288 | 03_Township:234 | Mongkhet | မိုင်းခတ် | update_name | 6331 | 95 | True |
| 289 | 03_Township:238 | Mongyang | မိုင်းယန်း | update_name_and_parent | 6338 | 95 | True |
| 290 | 03_Township:235 | Mongla | မိုင်းလား | update_name_and_parent | 7526 | 95 | True |
| 291 | 03_Township:233 | Monghsat | မိုင်းဆတ် | update_name | 6372 | 95 | True |
| 292 | 03_Township:236 | Mongping | မိုင်းပျဉ်း | update_name | 6312 | 95 | True |
| 293 | 03_Township:237 | Mongton | မိုင်းတုံ | create_mimu_placeholder |  | 100 | False |
| 294 | 03_Township:241 | Tachileik | တာချီလိတ် | keep_existing | 6390 | 100 | True |
| 295 | 03_Township:232 | Monghpyak | မိုင်းဖြတ် | update_name | 6370 | 95 | True |
| 296 | 03_Township:239 | Mongyawng | မိုင်းယောင်း | create_mimu_placeholder |  | 100 | False |
| 297 | 03_Township:27 | Pathein | ပုသိမ် | create_mimu_placeholder |  | 100 | False |
| 298 | 03_Township:13 | Kangyidaunt | ကန်ကြီးထောင့် | create_mimu_placeholder |  | 100 | False |
| 299 | 03_Township:29 | Thabaung | သာပေါင်း | create_mimu_placeholder |  | 100 | False |
| 300 | 03_Township:24 | Ngapudaw | ငပုတော | create_mimu_placeholder |  | 100 | False |
| 301 | 03_Township:17 | Kyonpyaw | ကျုံပျော် | create_mimu_placeholder |  | 100 | False |
| 302 | 03_Township:31 | Yegyi | ရေကြည် | create_mimu_placeholder |  | 100 | False |
| 303 | 03_Township:16 | Kyaunggon | ကျောင်းကုန်း | create_mimu_placeholder |  | 100 | False |
| 304 | 03_Township:11 | Hinthada | ဟင်္သာတ | create_mimu_placeholder |  | 100 | False |
| 305 | 03_Township:32 | Zalun | ဇလွန် | create_mimu_placeholder |  | 100 | False |
| 306 | 03_Township:19 | Lemyethna | လေးမျက်နှာ | create_mimu_placeholder |  | 100 | False |
| 307 | 03_Township:22 | Myanaung | မြန်အောင် | create_mimu_placeholder |  | 100 | False |
| 308 | 03_Township:15 | Kyangin | ကြံခင်း | create_mimu_placeholder |  | 100 | False |
| 309 | 03_Township:12 | Ingapu | အင်္ဂပူ | create_mimu_placeholder |  | 100 | False |
| 310 | 03_Township:23 | Myaungmya | မြောင်းမြ | create_mimu_placeholder |  | 100 | False |
| 311 | 03_Township:10 | Einme | အိမ်မဲ | create_mimu_placeholder |  | 100 | False |
| 312 | 03_Township:18 | Labutta | လပွတ္တာ | create_mimu_placeholder |  | 100 | False |
| 313 | 03_Township:30 | Wakema | ဝါးခယ်မ | create_mimu_placeholder |  | 100 | False |
| 314 | 03_Township:21 | Mawlamyinegyun | မော်လမြိုင်ကျွန်း | create_mimu_placeholder |  | 100 | False |
| 315 | 03_Township:20 | Maubin | မအူပင် | create_mimu_placeholder |  | 100 | False |
| 316 | 03_Township:26 | Pantanaw | ပန်းတနော် | create_mimu_placeholder |  | 100 | False |
| 317 | 03_Township:25 | Nyaungdon | ညောင်တုန်း | create_mimu_placeholder |  | 100 | False |
| 318 | 03_Township:8 | Danubyu | ဓနုဖြူ | create_mimu_placeholder |  | 100 | False |
| 319 | 03_Township:28 | Pyapon | ဖျာပုံ | create_mimu_placeholder |  | 100 | False |
| 320 | 03_Township:7 | Bogale | ဘိုကလေး | create_mimu_placeholder |  | 100 | False |
| 321 | 03_Township:14 | Kyaiklat | ကျိုက်လတ် | create_mimu_placeholder |  | 100 | False |
| 322 | 03_Township:9 | Dedaye | ဒေးဒရဲ | create_mimu_placeholder |  | 100 | False |
| 323 | 03_Township:172 | Zay Yar Thi Ri | ဇေယျာသီရိ | update_name_and_parent | 6046 | 95 | True |
| 324 | 03_Township:171 | Za Bu Thi Ri | ဇမ္ဗူသီရိ | update_name | 6029 | 95 | True |
| 325 | 03_Township:170 | Tatkon | တပ်ကုန်း | update_name | 6067 | 95 | True |
| 326 | 03_Township:165 | Det Khi Na Thi Ri | ဒက္ခိဏသီရိ | update_name | 6032 | 95 | True |
| 327 | 03_Township:168 | Poke Ba Thi Ri | ပုဗ္ဗသီရိ | update_name_and_parent | 6059 | 95 | True |
| 328 | 03_Township:169 | Pyinmana | ပျဉ်းမနား | update_name | 6038 | 95 | True |
| 329 | 03_Township:166 | Lewe | လယ်ဝေး | update_name | 5990 | 95 | True |
| 330 | 03_Township:167 | Oke Ta Ra Thi Ri | ဥတ္တရသီရိ | update_name | 7079 | 95 | True |

## Extra CoreMap areas

| Classification | Action | Count |
|---|---|---:|
| duplicate | merge_duplicate | 32 |
| foreign | disable_foreign | 5 |
| manual_review | manual_review | 546 |
| special_reference | mark_reference_only | 22 |

## Duplicate candidates

| Kind | Count |
|---|---:|
| extra_core_same_parent_name | 14 |
| multiple_core_candidates_for_one_source | 12 |
| multiple_sources_to_one_core | 59 |
| repeated_create_same_normalized_path | 155 |

## Postal validation

- Valid unique seven-digit codes: **17297**
- Duplicate extra source rows EN: **33**
- Duplicate extra source rows MY: **33**
- Combined duplicate extra row occurrences: **66**
- Quarantined malformed codes: **['114560']**
- ZIP SHA-256: `782daf6918f7355d9445ab417a9b20015bb49d6fb732a760571adc55635496ca`

| Postal action | Count |
|---|---:|
| link_local_admin | 1638 |
| link_township | 12298 |
| township_source_match_core_unresolved | 3341 |
| unmatched_postal_locality | 20 |

## Notes

- `audit_only_source_pcode` / `audit_only_parent_pcode` are audit keys only and must not be persisted as CoreMap identifiers.
- Matched rows set `preserve_existing_geom=true`; MIMU comparison geometry is never copied over an existing match.
- `create_mimu_placeholder` may use MIMU comparison geometry when available; it still must not assign a MIMU PCode/external id in production.
- Postal locality names never create admin polygons by themselves.

## Stop

Manifests written. No SQL migration created.
