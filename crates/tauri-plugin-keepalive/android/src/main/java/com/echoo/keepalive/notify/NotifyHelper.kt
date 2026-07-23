package com.echoo.keepalive.notify

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat

object NotifyHelper {
    fun showNotification(
        context: Context,
        notificationId: String,
        channelId: String,
        title: String,
        body: String
    ) {
        if (channelId == NotificationChannels.ACTIVITY_CHANNEL_ID) {
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
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(notificationId.hashCode(), notification)
    }

    fun cancel(context: Context, notificationId: String) {
        context.getSystemService(NotificationManager::class.java)
            .cancel(notificationId.hashCode())
    }
}
