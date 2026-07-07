package com.echoo.keepalive.socket

import org.json.JSONObject

data class KeepAliveMessage(val id: String, val title: String, val body: String)

object WsMessageParser {
    fun parse(text: String): KeepAliveMessage? {
        val json = JSONObject(text)
        if (json.optString("type") != "message.created") return null
        return KeepAliveMessage(
            id = json.optString("messageId"),
            title = json.optString("title", "Echoo"),
            body = json.optString("body", "New message")
        )
    }
}
