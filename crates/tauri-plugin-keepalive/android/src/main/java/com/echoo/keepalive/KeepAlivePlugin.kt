package com.echoo.keepalive

import android.app.Activity
import android.content.Intent
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.echoo.keepalive.service.MessageKeepAliveService

@TauriPlugin
class KeepAlivePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun start(invoke: Invoke) {
        activity.getSharedPreferences("keep_alive", Activity.MODE_PRIVATE)
            .edit()
            .putBoolean("enabled", true)
            .apply()

        val intent = Intent(activity, MessageKeepAliveService::class.java).apply {
            action = MessageKeepAliveService.ACTION_START
        }

        ContextCompat.startForegroundService(activity, intent)
        invoke.resolve()
    }

    @Command
    fun stop(invoke: Invoke) {
        activity.getSharedPreferences("keep_alive", Activity.MODE_PRIVATE)
            .edit()
            .putBoolean("enabled", false)
            .apply()

        val intent = Intent(activity, MessageKeepAliveService::class.java).apply {
            action = MessageKeepAliveService.ACTION_STOP
        }

        activity.startService(intent)
        invoke.resolve()
    }

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(mapOf("status" to "unsupported"))
    }
}
