package com.coremapmm.fieldsurveyor

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.coremapmm.fieldsurveyor.nav.FieldNavHost
import com.coremapmm.fieldsurveyor.survey.SurveyForegroundService
import com.coremapmm.fieldsurveyor.ui.theme.FieldTheme
import com.coremapmm.fieldsurveyor.ui.settings.FieldPreferences
import com.coremapmm.fieldsurveyor.ui.settings.FieldThemeMode
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.maplibre.android.MapLibre
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        MapLibre.getInstance(this)
        val graph = (application as FieldApp).graph
        if (intent?.action == ACTION_OPEN_SURVEY || graph.survey.state.value.running) {
            graph.survey.requestOpenSurvey()
        }
        val hasLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (hasLocation) {
            graph.survey.startupLocation()
        }
        lifecycleScope.launch {
            graph.survey.loadCachedVariant()
            if (graph.survey.state.value.running) {
                graph.survey.requestOpenSurvey()
                SurveyForegroundService.start(this@MainActivity)
            }
        }
        setContent {
            val display = remember { FieldPreferences(this) }
            CompositionLocalProvider(LocalFieldLanguage provides display.language) {
                FieldTheme(darkTheme = display.themeMode == FieldThemeMode.DARK) {
                    Surface(modifier = Modifier.fillMaxSize()) {
                        FieldNavHost(graph, display)
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_OPEN_SURVEY) {
            (application as FieldApp).graph.survey.requestOpenSurvey()
        }
    }

    override fun onResume() {
        super.onResume()
        (application as FieldApp).graph.survey.onHostResumed()
    }

    companion object {
        const val ACTION_OPEN_SURVEY = "com.coremapmm.fieldsurveyor.action.OPEN_SURVEY"
    }
}
