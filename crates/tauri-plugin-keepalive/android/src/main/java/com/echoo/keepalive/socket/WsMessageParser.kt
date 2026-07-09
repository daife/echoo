package com.echoo.keepalive.socket

import org.json.JSONObject

data class KeepAliveMessage(val id: String, val title: String, val body: String)

object WsMessageParser {
    fun parse(text: String): KeepAliveMessage? {
        val json = JSONObject(text)
        val type = json.optString("type")
        if (type != "message.created" && type != "message.completed") return null
        val message = json.optJSONObject("message") ?: return null
        val content = message.optJSONObject("content")
        val messageId = message.optString("id")
        if (messageId.isBlank()) return null

        return KeepAliveMessage(
            id = messageId,
            title = "Echoo",
            body = content?.optString("text")?.takeIf { it.isNotBlank() } ?: "New message"
        )
    }
}
