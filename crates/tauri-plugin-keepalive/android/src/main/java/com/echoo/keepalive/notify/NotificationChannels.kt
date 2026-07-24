package com.echoo.keepalive.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Notification
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build

object NotificationChannels {
    const val MESSAGE_CHANNEL_ID = "message_heads_up_v1"
    const val ACTIVITY_CHANNEL_ID = "activity_channel"

    private val MESSAGE_VIBRATION_PATTERN = longArrayOf(0, 240, 120, 240)

    fun createMessageChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                MESSAGE_CHANNEL_ID,
                "Echoo 会话消息",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "以悬浮通知提醒新的会话消息"
                enableVibration(true)
                vibrationPattern = MESSAGE_VIBRATION_PATTERN
                setShowBadge(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
            }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    fun createActivityChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                ACTIVITY_CHANNEL_ID,
                "Echoo activity",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
