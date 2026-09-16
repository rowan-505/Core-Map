package com.coremapmm.fieldsurveyor.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class FieldLocalizationTest {
    @Test
    fun myanmarModeTranslatesNavigationAndDynamicCounts() {
        assertEquals("ဆက်တင်များ", translateFieldText("Settings", FieldLanguage.MYANMAR))
        assertEquals("လမ်းကြောင်းတစ်ခုလုံးကို ပြမည်", translateFieldText("Show whole route", FieldLanguage.MYANMAR))
        assertEquals("ဦးတည်ရာအတိုင်း လိုက်မည်", translateFieldText("Follow heading", FieldLanguage.MYANMAR))
        assertEquals("ရွေးထားသော", translateFieldText("Selected", FieldLanguage.MYANMAR))
        assertEquals("မှတ်တိုင်", translateFieldText("stops", FieldLanguage.MYANMAR))
        assertEquals(
            "အသုံးပြုနိုင်သော လမ်းကြောင်းခွဲ 19 ခု",
            translateFieldText("19 variants available", FieldLanguage.MYANMAR),
        )
        assertNotEquals(
            "Select a stop before adding media.",
            translateFieldText("Select a stop before adding media.", FieldLanguage.MYANMAR),
        )
        assertNotEquals(
            "No selected-route stop is close enough. Check GPS or select a stop manually.",
            translateFieldText(
                "No selected-route stop is close enough. Check GPS or select a stop manually.",
                FieldLanguage.MYANMAR,
            ),
        )
        assertNotEquals(
            "Opposite direction is not in this snapshot. Refresh routes to switch.",
            translateFieldText(
                "Opposite direction is not in this snapshot. Refresh routes to switch.",
                FieldLanguage.MYANMAR,
            ),
        )
        assertNotEquals(
            "This session already has the same report type for this target.",
            translateFieldText(
                "This session already has the same report type for this target.",
                FieldLanguage.MYANMAR,
            ),
        )
        assertNotEquals(
            "No internet. Survey capture still works. Sync waits until you are online.",
            translateFieldText(
                "No internet. Survey capture still works. Sync waits until you are online.",
                FieldLanguage.MYANMAR,
            ),
        )
        assertNotEquals(
            "No YBS routes found near your current location.",
            translateFieldText("No YBS routes found near your current location.", FieldLanguage.MYANMAR),
        )
        assertNotEquals(
            "Recommend nearby route",
            translateFieldText("Recommend nearby route", FieldLanguage.MYANMAR),
        )
        assertEquals(
            "အားနည်းသော GPS တည်နေရာကို သုံးထားသည်။",
            translateFieldText("Using a weaker GPS fix.", FieldLanguage.MYANMAR),
        )
        assertEquals(
            "နောက်ဆုံးသိထားသော တည်နေရာကို သုံးထားသည်။",
            translateFieldText("Using last known location.", FieldLanguage.MYANMAR),
        )
        assertEquals("တည်နေရာ ရှာနေသည်…", translateFieldText("Finding location…", FieldLanguage.MYANMAR))
        assertEquals("တည်နေရာဖွင့်ပါ", translateFieldText("Turn on location", FieldLanguage.MYANMAR))
        assertEquals("တည်နေရာခွင့်ပြုချက် လိုသည်", translateFieldText("Location permission required", FieldLanguage.MYANMAR))
        assertEquals("တည်နေရာ မရနိုင်ပါ", translateFieldText("Location unavailable", FieldLanguage.MYANMAR))
        assertEquals("နောက်ဆုံးတည်နေရာ", translateFieldText("Last location", FieldLanguage.MYANMAR))
        assertEquals("နောက်ဆုံးတည်နေရာ", translateFieldText("Using last location", FieldLanguage.MYANMAR))
        assertEquals(
            "GPS အားနည်း · ±40m",
            translateFieldText("Weak GPS · ±40m", FieldLanguage.MYANMAR),
        )
        assertEquals("GPS ±8m", translateFieldText("GPS ±8m", FieldLanguage.MYANMAR))
        assertEquals("စစ်တမ်း ပြီးဆုံးမည်", translateFieldText("End survey", FieldLanguage.MYANMAR))
        assertEquals("ရပ်မည်", translateFieldText("Stop", FieldLanguage.MYANMAR))
        assertEquals(
            "အစီရင်ခံအမျိုးအစား မရွေးရသေးပါ",
            translateFieldText("No report type selected", FieldLanguage.MYANMAR),
        )
        assertEquals(
            "မှတ်တိုင်အသစ် · မြေပုံတည်နေရာ ရွေးပြီး",
            translateFieldText("New stop · Map position selected", FieldLanguage.MYANMAR),
        )
        assertEquals("စောင့်ဆိုင်း 2 ခု", translateFieldText("2 pending", FieldLanguage.MYANMAR))
        assertEquals("မှတ်တိုင်အသစ် တင်မည်", translateFieldText("Report new stop", FieldLanguage.MYANMAR))
        assertEquals("အစီရင်ခံစာ သိမ်းပြီး", translateFieldText("Report saved", FieldLanguage.MYANMAR))
        assertEquals("အော့ဖ်လိုင်းတွင် သိမ်းပြီး", translateFieldText("Saved offline", FieldLanguage.MYANMAR))
        assertEquals(
            "အော့ဖ်လိုင်းတွင် သိမ်းပြီး — စင့်ခ် ဆိုင်းငံ့ထားသည်",
            translateFieldText("Saved offline — sync pending", FieldLanguage.MYANMAR),
        )
        assertEquals(
            "သိမ်း၍မရပါ",
            translateFieldText("Could not save", FieldLanguage.MYANMAR),
        )
        assertEquals("စစ်တမ်း စတင်ပြီး", translateFieldText("Survey started", FieldLanguage.MYANMAR))
        assertEquals("စစ်တမ်း ရပ်ပြီး", translateFieldText("Survey stopped", FieldLanguage.MYANMAR))
        assertEquals("အစီရင်ခံစာ သိမ်း၍မရပါ", translateFieldText("Could not save report", FieldLanguage.MYANMAR))
        assertEquals("သိမ်းမည်", translateFieldText("Save", FieldLanguage.MYANMAR))
        assertEquals("အထောက်အထား · မထည့်လည်းရသည်", translateFieldText("Evidence · Optional", FieldLanguage.MYANMAR))
        assertEquals("ဖိထားပြီး အသံဖမ်းပါ", translateFieldText("Hold to record", FieldLanguage.MYANMAR))
        assertEquals("မြေပုံကို တစ်ချက်နှိပ်ပါ။", translateFieldText("Tap the map once.", FieldLanguage.MYANMAR))
        assertEquals("အော့ဖ်လိုင်း · ကောက်ယူမှု ဆက်လုပ်နိုင်သည်", translateFieldText("Offline · Capture still works", FieldLanguage.MYANMAR))
        assertEquals("ဓာတ်ပုံ ၁ ပုံ · အသံ 12 စက္ကန့်", translateFieldText("1 photo · 12-sec voice", FieldLanguage.MYANMAR))
        assertEquals("နည်းပညာ အသေးစိတ်", translateFieldText("Technical details", FieldLanguage.MYANMAR))
    }

    @Test
    fun englishModeKeepsOriginalCopy() {
        assertEquals("Settings", translateFieldText("Settings", FieldLanguage.ENGLISH))
        assertEquals(
            "19 variants available",
            translateFieldText("19 variants available", FieldLanguage.ENGLISH),
        )
    }
}
