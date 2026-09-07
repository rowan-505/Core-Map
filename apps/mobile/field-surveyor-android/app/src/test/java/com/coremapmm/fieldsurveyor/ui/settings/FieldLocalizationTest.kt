package com.coremapmm.fieldsurveyor.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class FieldLocalizationTest {
    @Test
    fun myanmarModeTranslatesNavigationAndDynamicCounts() {
        assertEquals("ဆက်တင်များ", translateFieldText("Settings", FieldLanguage.MYANMAR))
        assertEquals("လမ်းကြောင်းတစ်ခုလုံးကို ပြမည်", translateFieldText("Show whole route", FieldLanguage.MYANMAR))
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
