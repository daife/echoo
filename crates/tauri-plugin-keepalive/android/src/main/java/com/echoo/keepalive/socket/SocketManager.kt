package com.echoo.keepalive.socket

import android.content.Context
import com.echoo.keepalive.auth.AndroidTokenStore
import com.echoo.keepalive.notify.NotifyHelper
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
    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var executor: ScheduledExecutorService? = null
    @Volatile private var running = false
    @Volatile private var catchingUp = false
    private var reconnectAttempt = 0
    private val bufferedChanges = TreeMap<Long, JSONObject>()

    fun start(context: Context) {
        if (running) return
        running = true
        val appContext = context.applicationContext
        client = OkHttpClient.Builder()
            .pingInterval(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
        executor = Executors.newSingleThreadScheduledExecutor()
        executor?.execute { connect(appContext) }
    }

    private fun connect(context: Context) {
        if (!running) return
        try {
            val accessToken = ensureAccessToken(context) ?: throw IllegalStateException("No valid session")
            val ticket = requestTicket(context, accessToken)
                ?: requestTicket(context, refresh(context) ?: throw IllegalStateException("Refresh failed"))
                ?: throw IllegalStateException("Ticket failed")
            val socketUrl = AndroidTokenStore.wsUrl(context).toHttpUrl().newBuilder()
                .addQueryParameter("ticket", ticket)
                .build()
            val request = Request.Builder().url(socketUrl).build()
            webSocket = client!!.newWebSocket(request, listener(context))
        } catch (_: Throwable) {
            scheduleReconnect(context)
        }
    }

    private fun listener(context: Context) = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            reconnectAttempt = 0
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val json = runCatching { JSONObject(text) }.getOrNull() ?: return
            when (json.optString("type")) {
                "realtime.ready" -> {
                    catchingUp = true
                    executor?.execute { catchUp(context, json.optLong("headCursor")) }
                }
                "sync.change" -> handleChange(context, json.optJSONObject("change") ?: return)
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (running) scheduleReconnect(context)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (running) scheduleReconnect(context)
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

    private fun catchUp(context: Context, headCursor: Long) {
        try {
            var cursor = AndroidTokenStore.cursor(context)
            var token = ensureAccessToken(context) ?: return
            while (running && cursor < headCursor) {
                val url = "${AndroidTokenStore.apiBaseUrl(context)}/sync"
                    .toHttpUrl().newBuilder()
                    .addQueryParameter("after", cursor.toString())
                    .addQueryParameter("limit", "500")
                    .build()
                var response = client!!.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build()).execute()
                if (response.code == 401) {
                    response.close()
                    token = refresh(context) ?: return
                    response = client!!.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build()).execute()
                }
                response.use {
                    if (!it.isSuccessful) return
                    val page = JSONObject(it.body?.string().orEmpty())
                    if (page.optBoolean("resetRequired")) {
                        AndroidTokenStore.saveCursor(context, page.optLong("headCursor"))
                        return
                    }
                    val changes = page.optJSONArray("changes") ?: return
                    for (index in 0 until changes.length()) applyChange(context, changes.getJSONObject(index))
                    cursor = page.optLong("cursor", cursor)
                    if (!page.optBoolean("hasMore") && cursor >= headCursor) break
                }
            }
        } finally {
            synchronized(this) {
                catchingUp = false
                bufferedChanges.values.forEach { applyChange(context, it) }
                bufferedChanges.clear()
            }
        }
    }

    private fun applyChange(context: Context, change: JSONObject) {
        val cursor = change.optLong("cursor")
        if (cursor <= AndroidTokenStore.cursor(context)) return
        AndroidTokenStore.saveCursor(context, cursor)
        if (change.optString("entityType") != "message" || change.optString("operation") != "upsert") return
        val message = change.optJSONObject("entity")?.optJSONObject("value") ?: return
        if (message.optString("role") != "assistant") return
        val content = message.optJSONObject("content")
        val id = message.optString("id")
        if (id.isBlank()) return
        NotifyHelper.showMessageNotification(
            context,
            "Echoo",
            content?.optString("text")?.takeIf { it.isNotBlank() } ?: "New message",
            id
        )
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

    private fun scheduleReconnect(context: Context) {
        if (!running) return
        webSocket = null
        val base = min(30_000L, 1_000L shl min(reconnectAttempt, 5))
        reconnectAttempt += 1
        val delay = (base * (0.8 + Random.nextDouble() * 0.4)).toLong()
        executor?.schedule({ connect(context) }, delay, TimeUnit.MILLISECONDS)
    }

    fun stop() {
        running = false
        catchingUp = false
        synchronized(this) { bufferedChanges.clear() }
        webSocket?.close(1000, "client stop")
        webSocket = null
        executor?.shutdownNow()
        executor = null
        client?.dispatcher?.executorService?.shutdown()
        client = null
    }
}
