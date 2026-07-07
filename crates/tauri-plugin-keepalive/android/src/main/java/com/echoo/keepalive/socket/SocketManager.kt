package com.echoo.keepalive.socket

import android.content.Context
import com.echoo.keepalive.auth.AndroidTokenStore
import com.echoo.keepalive.config.KeepAliveConfig
import com.echoo.keepalive.notify.NotifyHelper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

object SocketManager {
    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var running = false

    fun start(context: Context) {
        if (running) return
        running = true

        val appContext = context.applicationContext
        client = OkHttpClient.Builder()
            .pingInterval(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        val token = AndroidTokenStore.getAccessToken(appContext)
        val request = Request.Builder()
            .url(KeepAliveConfig.wsUrl)
            .addHeader("Authorization", "Bearer $token")
            .build()

        webSocket = client!!.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = WsMessageParser.parse(text) ?: return
                NotifyHelper.showMessageNotification(appContext, message.title, message.body, message.id)
                AckSender.send(webSocket, message.id)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                running = false
            }
        })
    }

    fun stop() {
        running = false
        webSocket?.close(1000, "client stop")
        webSocket = null
        client?.dispatcher?.executorService?.shutdown()
        client = null
    }
}
