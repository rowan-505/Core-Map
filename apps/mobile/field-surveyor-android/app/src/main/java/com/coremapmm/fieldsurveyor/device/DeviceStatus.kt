package com.coremapmm.fieldsurveyor.device

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.StatFs

object DeviceStatus {
    const val LOW_STORAGE_BYTES: Long = 200L * 1024L * 1024L

    fun isOnline(context: Context): Boolean {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun isMetered(context: Context): Boolean {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        return manager.isActiveNetworkMetered
    }

    fun usableBytes(context: Context): Long {
        return StatFs(context.filesDir.absolutePath).availableBytes
    }

    fun isLowStorage(usableBytes: Long, thresholdBytes: Long = LOW_STORAGE_BYTES): Boolean {
        return usableBytes < thresholdBytes
    }

    fun isLowStorage(context: Context): Boolean {
        return isLowStorage(usableBytes(context))
    }
}
