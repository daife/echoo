# Sync Protocol

Startup and resume flow:

```text
app starts
  -> check auth
  -> GET the latest conversation message page from MySQL
  -> keep the visible page in memory
  -> start MessageRuntime realtime
```

Realtime flow:

```text
bound external interface receives user text
  -> server appends it to the bound figure session
  -> model produces a reply for that same session
  -> server sends message.created to Echoo clients
  -> server mirrors the reply through the bound interface
  -> foreground client updates the in-memory conversation page
  -> background Android service shows notification only
  -> client or service sends ack
```

Read state is separate from ACK. ACK means the device received the message. Read means the user viewed the message in the app.
