export function SettingsPage() {
  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-white/38">Account</p>
        <h1 className="mt-2 text-4xl font-semibold text-white">Settings</h1>
      </div>
      <div className="glass-panel rounded-2xl divide-y divide-white/8">
        {[
          ["Account system", "Email login, token refresh, multi-device sessions"],
          ["Storage runtime", "Web IndexedDB now, Tauri SQLite later"],
          ["Realtime", "WebSocket foreground on Web, native keepalive on Android"],
          ["Interface binding", "One external interface can bind to one agent conversation"],
          ["Notifications", "Native service owns Android background notifications"]
        ].map(([title, detail]) => (
          <div key={title} className="flex items-center justify-between gap-5 p-5">
            <div>
              <h2 className="font-medium text-white">{title}</h2>
              <p className="mt-1 text-sm text-white/42">{detail}</p>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">planned</span>
          </div>
        ))}
      </div>
    </section>
  );
}
