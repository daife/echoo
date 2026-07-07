package com.echoo.keepalive.socket

import okhttp3.WebSocket
import org.json.JSONObject

object AckSender {
    fun send(webSocket: WebSocket, messageId: String) {
        val payload = JSONObject()
            .put("type", "ack")
            .put("messageId", messageId)
        webSocket.send(payload.toString())
    }
}
