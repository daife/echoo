package com.echoo.keepalive.auth

import android.content.Context

object AndroidTokenStore {
    fun getAccessToken(context: Context): String {
        return context.getSharedPreferences("auth", Context.MODE_PRIVATE)
            .getString("access_token", "") ?: ""
    }
}
