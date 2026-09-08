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
        assertEquals("GPS ရှာနေသည်…", translateFieldText("Finding GPS…", FieldLanguage.MYANMAR))
        assertEquals("GPS ပိတ်ထားသည်", translateFieldText("GPS off", FieldLanguage.MYANMAR))
        assertEquals("GPS ခွင့်ပြုချက် လိုသည်", translateFieldText("GPS permission needed", FieldLanguage.MYANMAR))
        assertEquals(
            "GPS ဟောင်း · ±5 m",
            translateFieldText("GPS stale · ±5 m", FieldLanguage.MYANMAR),
        )
        assertEquals(
            "GPS အားနည်း · ±40 m",
            translateFieldText("GPS weak · ±40 m", FieldLanguage.MYANMAR),
        )
        assertEquals("မှတ်တိုင်အသစ် တင်မည်", translateFieldText("Report new stop", FieldLanguage.MYANMAR))
        assertEquals("အစီရင်ခံစာ သိမ်းပြီး", translateFieldText("Report saved", FieldLanguage.MYANMAR))
        assertEquals("အော့ဖ်လိုင်းတွင် သိမ်းပြီး", translateFieldText("Saved offline", FieldLanguage.MYANMAR))
        assertEquals("အစီရင်ခံစာ သိမ်း၍မရပါ", translateFieldText("Could not save report", FieldLanguage.MYANMAR))
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
