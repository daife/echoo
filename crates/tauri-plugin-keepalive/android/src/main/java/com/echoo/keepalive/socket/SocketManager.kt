package com.echoo.keepalive.socket

import android.content.Context
import android.util.Log
import com.echoo.keepalive.auth.AndroidTokenStore
import com.echoo.keepalive.notify.NotifyHelper
import com.echoo.keepalive.notify.NotificationChannels
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.util.TreeMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

object SocketManager {
    private const val TAG = "EchooKeepAlive"
    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var executor: ScheduledExecutorService? = null
    @Volatile private var running = false
    @Volatile private var catchingUp = false
    @Volatile private var generation = 0L
    private var reconnectAttempt = 0
    private val bufferedChanges = TreeMap<Long, JSONObject>()

    @Synchronized
    fun start(context: Context) {
        if (running) return
        running = true
        generation += 1
        reconnectAttempt = 0
        val activeGeneration = generation
        val appContext = context.applicationContext
        client = OkHttpClient.Builder()
            .pingInterval(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
        executor = Executors.newSingleThreadScheduledExecutor()
        executor?.execute { connect(appContext, activeGeneration) }
    }

    private fun connect(context: Context, activeGeneration: Long) {
        if (!isActive(activeGeneration)) return
        try {
            val accessToken = ensureAccessToken(context) ?: throw IllegalStateException("No valid session")
            val ticket = requestTicket(context, accessToken)
                ?: requestTicket(context, refresh(context) ?: throw IllegalStateException("Refresh failed"))
                ?: throw IllegalStateException("Ticket failed")
            val socketUrl = AndroidTokenStore.wsUrl(context)
                .replaceFirst("wss://", "https://", ignoreCase = true)
                .replaceFirst("ws://", "http://", ignoreCase = true)
                .toHttpUrl()
                .newBuilder()
                .addQueryParameter("ticket", ticket)
                .build()
            val request = Request.Builder().url(socketUrl).build()
            webSocket = client!!.newWebSocket(request, listener(context, activeGeneration))
        } catch (error: Throwable) {
            Log.w(TAG, "Unable to open the background realtime connection", error)
            scheduleReconnect(context, activeGeneration)
        }
    }

    private fun listener(context: Context, activeGeneration: Long) = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (isActive(activeGeneration)) {
                reconnectAttempt = 0
                Log.i(TAG, "Background realtime connection opened")
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!isActive(activeGeneration)) return
            val json = runCatching { JSONObject(text) }.getOrNull() ?: return
            when (json.optString("type")) {
                "realtime.ready" -> {
                    catchingUp = true
                    executor?.execute {
                        runCatching { catchUp(context, json.optLong("headCursor"), activeGeneration) }
                            .onFailure {
                                Log.w(TAG, "Unable to catch up background sync", it)
                                webSocket.cancel()
                            }
                    }
                }
                "sync.change" -> handleChange(context, json.optJSONObject("change") ?: return)
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "Background realtime connection failed", t)
            if (isActive(activeGeneration)) scheduleReconnect(context, activeGeneration)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (isActive(activeGeneration)) scheduleReconnect(context, activeGeneration)
        }
    }

    @Synchronized
    private fun handleChange(context: Context, change: JSONObject) {
        val cursor = change.optLong("cursor")
        if (cursor <= AndroidTokenStore.cursor(context)) return
        if (catchingUp) {
            bufferedChanges[cursor] = change
            return
        }
        applyChange(context, change)
    }

    private fun catchUp(context: Context, headCursor: Long, activeGeneration: Long) {
        var completed = false
        try {
            var cursor = AndroidTokenStore.cursor(context)
            var token = ensureAccessToken(context)
                ?: throw IllegalStateException("No valid session for sync")
            while (isActive(activeGeneration) && cursor < headCursor) {
                val url = "${AndroidTokenStore.apiBaseUrl(context)}/sync"
                    .toHttpUrl().newBuilder()
                    .addQueryParameter("after", cursor.toString())
                    .addQueryParameter("limit", "500")
                    .build()
                var response = client!!.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build()).execute()
                if (response.code == 401) {
                    response.close()
                    token = refresh(context)
                        ?: throw IllegalStateException("Refresh failed during sync")
                    response = client!!.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build()).execute()
                }
                var reachedHeadCursor = false
                response.use {
                    if (!it.isSuccessful) {
                        throw IllegalStateException("Sync request failed with ${it.code}")
                    }
                    val page = JSONObject(it.body?.string().orEmpty())
                    if (page.optBoolean("resetRequired")) {
                        AndroidTokenStore.saveCursor(context, page.optLong("headCursor"))
                        completed = true
                        return
                    }
                    val changes = page.optJSONArray("changes")
                        ?: throw IllegalStateException("Sync response has no changes")
                    for (index in 0 until changes.length()) applyChange(context, changes.getJSONObject(index))
                    cursor = page.optLong("cursor", cursor)
                    reachedHeadCursor = !page.optBoolean("hasMore") && cursor >= headCursor
                }
                if (reachedHeadCursor) break
            }
            completed = isActive(activeGeneration)
        } finally {
            synchronized(this) {
                if (generation == activeGeneration) {
                    catchingUp = false
                    if (completed) bufferedChanges.values.forEach { applyChange(context, it) }
                    bufferedChanges.clear()
                }
            }
        }
    }

    private fun applyChange(context: Context, change: JSONObject) {
        val cursor = change.optLong("cursor")
        if (cursor <= AndroidTokenStore.cursor(context)) return
        AndroidTokenStore.saveCursor(context, cursor)
        if (change.optString("operation") != "upsert") return
        val entity = change.optJSONObject("entity") ?: return
        val value = entity.optJSONObject("value") ?: return
        when (change.optString("entityType")) {
            "conversation" -> {
                val id = value.optString("id")
                if (id.isBlank()) return
                val notificationId = "conversation:$id"
                if (value.optInt("unreadCount") <= 0) {
                    NotifyHelper.cancel(context, notificationId)
                    return
                }
                val name = value.optString("title").ifBlank { "角色" }
                NotifyHelper.showNotification(
                    context,
                    notificationId,
                    NotificationChannels.MESSAGE_CHANNEL_ID,
                    "Echoo",
                    "${name}发来一条新消息"
                )
            }
            "notification-state" -> {
                if (!value.optBoolean("activityUnread")) {
                    NotifyHelper.cancel(context, "activity")
                    return
                }
                NotifyHelper.showNotification(
                    context,
                    "activity",
                    NotificationChannels.ACTIVITY_CHANNEL_ID,
                    "Echoo",
                    "你有一条新的动态待查看"
                )
            }
        }
    }

    private fun ensureAccessToken(context: Context): String? {
        val current = AndroidTokenStore.accessToken(context)
        return if (current.isNotBlank() && AndroidTokenStore.expiresAt(context) > System.currentTimeMillis() + 30_000)
            current else refresh(context)
    }

    private fun requestTicket(context: Context, token: String): String? {
        val request = Request.Builder()
            .url("${AndroidTokenStore.apiBaseUrl(context)}/realtime/ticket")
            .header("Authorization", "Bearer $token")
            .post(ByteArray(0).toRequestBody(null))
            .build()
        return client!!.newCall(request).execute().use {
            if (!it.isSuccessful) null else JSONObject(it.body?.string().orEmpty()).optString("ticket").ifBlank { null }
        }
    }

    private fun refresh(context: Context): String? {
        val refreshToken = AndroidTokenStore.refreshToken(context)
        if (refreshToken.isBlank()) return null
        val body = JSONObject().put("refreshToken", refreshToken).toString()
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${AndroidTokenStore.apiBaseUrl(context)}/auth/refresh")
            .post(body)
            .build()
        return client!!.newCall(request).execute().use {
            if (!it.isSuccessful) return null
            val tokens = JSONObject(it.body?.string().orEmpty()).getJSONObject("tokens")
            val access = tokens.getString("accessToken")
            AndroidTokenStore.rotate(
                context,
                access,
                tokens.getString("refreshToken"),
                tokens.getLong("expiresAt")
            )
            access
        }
    }

    private fun scheduleReconnect(context: Context, activeGeneration: Long) {
        if (!isActive(activeGeneration)) return
        webSocket = null
        val base = min(30_000L, 1_000L shl min(reconnectAttempt, 5))
        reconnectAttempt += 1
        val delay = (base * (0.8 + Random.nextDouble() * 0.4)).toLong()
        executor?.schedule(
            { connect(context, activeGeneration) },
            delay,
            TimeUnit.MILLISECONDS
        )
    }

    @Synchronized
    fun stop() {
        running = false
        generation += 1
        catchingUp = false
        synchronized(this) { bufferedChanges.clear() }
        webSocket?.close(1000, "client stop")
        webSocket = null
        executor?.shutdownNow()
        executor = null
        client?.dispatcher?.executorService?.shutdown()
        client = null
    }

    private fun isActive(activeGeneration: Long) =
        running && generation == activeGeneration
}
