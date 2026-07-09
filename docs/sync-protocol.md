# Sync Protocol

Startup and resume flow:

```text
app starts
  -> check auth
  -> read last_message_id
  -> GET /api/messages?after=last_message_id
  -> save messages with StorageRuntime
  -> update sync cursor
  -> start MessageRuntime realtime
```

Realtime flow:

```text
bound external interface receives user text
  -> server appends it to the bound figure session
  -> model produces a reply for that same session
  -> server sends message.created to Echoo clients
  -> server mirrors the reply through the bound interface
  -> foreground client stores message and updates UI
  -> background Android service shows notification only
  -> client or service sends ack
```

Read state is separate from ACK. ACK means the device received the message. Read means the user viewed the message in the app.
