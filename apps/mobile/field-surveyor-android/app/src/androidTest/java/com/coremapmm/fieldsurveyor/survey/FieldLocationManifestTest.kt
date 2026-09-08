package com.coremapmm.fieldsurveyor.survey

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FieldLocationManifestTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun surveyTrackingDoesNotRequestBackgroundLocation() {
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS,
        )
        val requested = info.requestedPermissions?.toSet().orEmpty()
        assertTrue(requested.contains(Manifest.permission.ACCESS_FINE_LOCATION))
        assertTrue(requested.contains(Manifest.permission.FOREGROUND_SERVICE_LOCATION))
        assertFalse(requested.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
    }

    @Test
    fun surveyForegroundServiceIsLocationTypeAndNotExported() {
        val service = context.packageManager.getServiceInfo(
            android.content.ComponentName(context, SurveyForegroundService::class.java),
            PackageManager.GET_META_DATA,
        )
        assertFalse(service.exported)
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            service.foregroundServiceType and ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
        )
    }

    @Test
    fun surveyNotificationCopyIsPresent() {
        assertTrue(context.getString(R.string.survey_notification_title).isNotBlank())
        assertTrue(context.getString(R.string.survey_notification_text).isNotBlank())
    }
}
