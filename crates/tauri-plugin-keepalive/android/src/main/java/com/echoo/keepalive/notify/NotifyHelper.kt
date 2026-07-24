package com.echoo.keepalive.notify

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat

object NotifyHelper {
    private val MESSAGE_VIBRATION_PATTERN = longArrayOf(0, 240, 120, 240)

    fun showNotification(
        context: Context,
        notificationId: String,
        channelId: String,
        title: String,
        body: String
    ) {
        val isMessage = channelId == NotificationChannels.MESSAGE_CHANNEL_ID
        if (!isMessage) {
            NotificationChannels.createActivityChannel(context)
        } else {
            NotificationChannels.createMessageChannel(context)
        }

        val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationId.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, channelId)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .apply {
                if (isMessage) {
                    setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    setPriority(NotificationCompat.PRIORITY_HIGH)
                    setDefaults(NotificationCompat.DEFAULT_ALL)
                    setVibrate(MESSAGE_VIBRATION_PATTERN)
                    setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                } else {
                    setPriority(NotificationCompat.PRIORITY_DEFAULT)
                }
            }
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(notificationId.hashCode(), notification)
    }

    fun cancel(context: Context, notificationId: String) {
        context.getSystemService(NotificationManager::class.java)
            .cancel(notificationId.hashCode())
    }
}
