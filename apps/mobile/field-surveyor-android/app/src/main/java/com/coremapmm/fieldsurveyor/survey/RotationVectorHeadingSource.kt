package com.coremapmm.fieldsurveyor.survey

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.Surface

/**
 * Device-pointing heading from the rotation vector. This is not YBS D0/D1.
 * Register once for the survey map lifecycle; do not recreate on GPS ticks.
 */
class RotationVectorHeadingSource(
    context: Context,
    private val onSample: (headingDeg: Float?, usable: Boolean) -> Unit,
) : SensorEventListener {
    private val app = context.applicationContext
    private val sensors = app.getSystemService(SensorManager::class.java)
    private val displays = app.getSystemService(DisplayManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val rotation = FloatArray(9)
    private val remapped = FloatArray(9)
    private val orientation = FloatArray(3)
    private var lastEmitElapsedMs = 0L
    private var accuracy = SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM

    fun start(): Boolean {
        val sensor = sensors?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        if (sensor == null) {
            emit(null, false)
            return false
        }
        return sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
    }

    fun stop() {
        sensors?.unregisterListener(this)
        main.removeCallbacksAndMessages(null)
    }

    override fun onSensorChanged(event: SensorEvent) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastEmitElapsedMs < EMIT_INTERVAL_MS) return
        lastEmitElapsedMs = now
        val usable = accuracyUsable(accuracy)
        if (!usable) {
            emit(null, false)
            return
        }
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        val displayRotation = displays?.getDisplay(Display.DEFAULT_DISPLAY)?.rotation
            ?: Surface.ROTATION_0
        val axisX: Int
        val axisY: Int
        when (displayRotation) {
            Surface.ROTATION_90 -> {
                axisX = SensorManager.AXIS_Y
                axisY = SensorManager.AXIS_MINUS_X
            }
            Surface.ROTATION_180 -> {
                axisX = SensorManager.AXIS_MINUS_X
                axisY = SensorManager.AXIS_MINUS_Y
            }
            Surface.ROTATION_270 -> {
                axisX = SensorManager.AXIS_MINUS_Y
                axisY = SensorManager.AXIS_X
            }
            else -> {
                axisX = SensorManager.AXIS_X
                axisY = SensorManager.AXIS_Y
            }
        }
        SensorManager.remapCoordinateSystem(rotation, axisX, axisY, remapped)
        SensorManager.getOrientation(remapped, orientation)
        var degrees = Math.toDegrees(orientation[0].toDouble())
        if (degrees < 0.0) degrees += 360.0
        emit(degrees.toFloat(), true)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        this.accuracy = accuracy
        if (!accuracyUsable(accuracy)) {
            emit(null, false)
        }
    }

    private fun emit(headingDeg: Float?, usable: Boolean) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            onSample(headingDeg, usable)
        } else {
            main.post { onSample(headingDeg, usable) }
        }
    }

    companion object {
        const val EMIT_INTERVAL_MS = 120L

        fun accuracyUsable(accuracy: Int): Boolean =
            accuracy == SensorManager.SENSOR_STATUS_ACCURACY_HIGH ||
                accuracy == SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM ||
                accuracy == SensorManager.SENSOR_STATUS_ACCURACY_LOW
    }
}
