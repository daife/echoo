package com.echoo.keepalive.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object AndroidTokenStore {
    private fun preferences(context: Context) = EncryptedSharedPreferences.create(
        context,
        "echoo_native_auth",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun save(
        context: Context,
        accessToken: String,
        refreshToken: String,
        expiresAt: Long,
        cursor: Long,
        wsUrl: String,
        apiBaseUrl: String
    ) {
        preferences(context).edit()
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .putLong("expires_at", expiresAt)
            .putLong("sync_cursor", cursor)
            .putString("ws_url", wsUrl)
            .putString("api_base_url", apiBaseUrl.trimEnd('/'))
            .apply()
    }

    fun accessToken(context: Context) = preferences(context).getString("access_token", "") ?: ""
    fun refreshToken(context: Context) = preferences(context).getString("refresh_token", "") ?: ""
    fun expiresAt(context: Context) = preferences(context).getLong("expires_at", 0)
    fun cursor(context: Context) = preferences(context).getLong("sync_cursor", 0)
    fun wsUrl(context: Context) = preferences(context).getString("ws_url", "") ?: ""
    fun apiBaseUrl(context: Context) = preferences(context).getString("api_base_url", "") ?: ""
    fun saveCursor(context: Context, cursor: Long) = preferences(context).edit().putLong("sync_cursor", cursor).apply()

    fun snapshot(context: Context) = mapOf(
        "accessToken" to accessToken(context),
        "refreshToken" to refreshToken(context),
        "expiresAt" to expiresAt(context),
        "cursor" to cursor(context)
    )

    fun rotate(context: Context, accessToken: String, refreshToken: String, expiresAt: Long) {
        preferences(context).edit()
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .putLong("expires_at", expiresAt)
            .apply()
    }

    fun clear(context: Context) {
        preferences(context).edit().clear().apply()
    }
}
