import { useAuth } from "../../app/providers/AuthProvider";

export function SettingsPage() {
  const auth = useAuth();

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-white/38">Account</p>
        <h1 className="mt-2 text-4xl font-semibold text-white">Settings</h1>
      </div>
      <div className="glass-panel flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-medium text-white">{auth.user?.displayName}</h2>
          <p className="mt-1 text-sm text-white/42">{auth.user?.email}</p>
        </div>
        <button
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition hover:border-white/20 hover:text-white active:scale-95"
          onClick={() => void auth.signOut()}
        >
          Sign out
        </button>
      </div>
      <div className="glass-panel rounded-2xl divide-y divide-white/8">
        {[
          ["Account system", "Email login, token refresh, multi-device sessions"],
          ["Storage runtime", "Web IndexedDB now, Tauri SQLite later"],
          ["Realtime", "WebSocket foreground on Web, native keepalive on Android"],
          ["Interface binding", "One external interface can bind to one figure session"],
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
