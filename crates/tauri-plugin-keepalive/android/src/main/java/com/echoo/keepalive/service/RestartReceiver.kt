package com.echoo.keepalive.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class RestartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val serviceIntent = Intent(context, MessageKeepAliveService::class.java).apply {
            action = MessageKeepAliveService.ACTION_START
        }
        ContextCompat.startForegroundService(context, serviceIntent)
    }
}
