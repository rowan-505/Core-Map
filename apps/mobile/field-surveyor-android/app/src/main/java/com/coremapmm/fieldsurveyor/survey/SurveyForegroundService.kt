package com.coremapmm.fieldsurveyor.survey

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.coremapmm.fieldsurveyor.FieldApp
import com.coremapmm.fieldsurveyor.MainActivity
import com.coremapmm.fieldsurveyor.R

/** Keeps the existing fused survey pipeline eligible while the app is backgrounded. */
class SurveyForegroundService : Service() {
    private val survey: SurveyController
        get() = (application as FieldApp).graph.survey

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (commandFor(intent?.action) == Command.STOP) {
            survey.stopFromNotification()
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }

        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } catch (_: RuntimeException) {
            survey.stopFromNotification()
            stopSelf(startId)
            return START_NOT_STICKY
        }

        if (!survey.restoreActiveSurvey()) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setContentTitle(getString(R.string.survey_notification_title))
        .setContentText(getString(R.string.survey_notification_text))
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(returnToSurveyIntent())
        .addAction(0, getString(R.string.survey_notification_return), returnToSurveyIntent())
        .addAction(0, getString(R.string.survey_notification_stop), stopSurveyIntent())
        .build()

    private fun returnToSurveyIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        REQUEST_RETURN,
        Intent(this, MainActivity::class.java).apply {
            action = MainActivity.ACTION_OPEN_SURVEY
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun stopSurveyIntent(): PendingIntent = PendingIntent.getService(
        this,
        REQUEST_STOP,
        Intent(this, SurveyForegroundService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.survey_notification_channel),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.survey_notification_channel_desc)
                setShowBadge(false)
            },
        )
    }

    enum class Command { START_OR_RESTORE, STOP }

    companion object {
        const val ACTION_START = "com.coremapmm.fieldsurveyor.action.START_SURVEY_TRACKING"
        const val ACTION_STOP = "com.coremapmm.fieldsurveyor.action.STOP_SURVEY_TRACKING"
        private const val CHANNEL_ID = "active_survey"
        private const val NOTIFICATION_ID = 4102
        private const val REQUEST_RETURN = 4103
        private const val REQUEST_STOP = 4104

        fun commandFor(action: String?): Command =
            if (action == ACTION_STOP) Command.STOP else Command.START_OR_RESTORE

        fun start(context: Context): Boolean = try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, SurveyForegroundService::class.java).setAction(ACTION_START),
            )
            true
        } catch (_: RuntimeException) {
            false
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SurveyForegroundService::class.java))
        }
    }
}
