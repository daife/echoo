package com.echoo.keepalive

import android.app.Activity
import android.content.Intent
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.echoo.keepalive.service.MessageKeepAliveService
import com.echoo.keepalive.auth.AndroidTokenStore
import com.echoo.keepalive.socket.SocketManager

@InvokeArg
internal class StartArgs {
    lateinit var accessToken: String
    lateinit var refreshToken: String
    lateinit var wsUrl: String
    lateinit var apiBaseUrl: String
    var expiresAt: Long = 0
    var cursor: Long = 0
    var ensureService: Boolean = true
    var activateSocket: Boolean = false
    var resumeOnly: Boolean = false
}

@TauriPlugin
class KeepAlivePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun start(invoke: Invoke) {
        val args = invoke.parseArgs(StartArgs::class.java)
        AndroidTokenStore.save(
            activity,
            args.accessToken,
            args.refreshToken,
            args.expiresAt,
            args.cursor,
            args.wsUrl,
            args.apiBaseUrl
        )
        if (args.activateSocket) SocketManager.start(activity.applicationContext)
        if (!args.ensureService) {
            invoke.resolve()
            return
        }

        val preferences = activity.getSharedPreferences("keep_alive", Activity.MODE_PRIVATE)
        if (args.resumeOnly && !preferences.getBoolean("enabled", false)) {
            invoke.resolve()
            return
        }
        if (!args.resumeOnly) {
            preferences.edit()
                .putBoolean("enabled", true)
                .apply()
        }

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

        SocketManager.stop()
        activity.stopService(Intent(activity, MessageKeepAliveService::class.java))
        AndroidTokenStore.clear(activity)
        invoke.resolve()
    }

    @Command
    fun status(invoke: Invoke) {
        val enabled = activity.getSharedPreferences("keep_alive", Activity.MODE_PRIVATE)
            .getBoolean("enabled", false)
        val running = enabled && MessageKeepAliveService.isRunning
        invoke.resolveObject(if (running) "running" else "stopped")
    }

    @Command
    fun handoff(invoke: Invoke) {
        val state = AndroidTokenStore.snapshot(activity)
        SocketManager.stop()
        invoke.resolveObject(state)
    }
}
