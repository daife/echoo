package com.echoo.keepalive.service

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.echoo.keepalive.notify.NotificationChannels
import com.echoo.keepalive.socket.SocketManager

class MessageKeepAliveService : Service(), DefaultLifecycleObserver {
    companion object {
        const val ACTION_START = "com.echoo.keepalive.START"
        private const val NOTIFICATION_ID = 1001
        @Volatile var isRunning = false
            private set
    }

    override fun onCreate() {
        super<Service>.onCreate()
        isRunning = true
        NotificationChannels.prepare(this)
        NotificationChannels.createServiceChannel(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startAsForeground()
        if (isAppInForeground()) SocketManager.stop()
        else SocketManager.start(applicationContext)
        return START_STICKY
    }

    override fun onStart(owner: LifecycleOwner) {
        SocketManager.stop()
    }

    override fun onStop(owner: LifecycleOwner) {
        val enabled = getSharedPreferences("keep_alive", MODE_PRIVATE)
            .getBoolean("enabled", false)
        if (enabled) SocketManager.start(applicationContext)
    }

    override fun onDestroy() {
        ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
        SocketManager.stop()
        isRunning = false
        super<Service>.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startAsForeground() {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = openIntent?.let {
            PendingIntent.getActivity(
                this,
                1001,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        val notification = NotificationCompat.Builder(this, NotificationChannels.SERVICE_CHANNEL_ID)
            .setContentTitle("Echoo")
            .setContentText("正在后台接收新消息")
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
            .build()

        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
        )
    }

    private fun isAppInForeground() = ProcessLifecycleOwner.get().lifecycle
        .currentState.isAtLeast(Lifecycle.State.STARTED)
}
