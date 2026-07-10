import { useAuth } from "../../app/providers/AuthProvider";

export function SettingsPage() {
  const auth = useAuth();

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-white/38">账户</p>
        <h1 className="mt-2 text-4xl font-semibold text-white">设置</h1>
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
          退出登录
        </button>
      </div>
      <div className="glass-panel rounded-2xl divide-y divide-white/8">
        {[
          ["账户系统", "邮箱登录、令牌刷新与多设备会话"],
          ["存储运行时", "网页端使用 IndexedDB，之后支持 Tauri SQLite"],
          ["实时通信", "网页端前台使用 WebSocket，Android 使用原生保活"],
          ["接口绑定", "一个外部接口可以绑定一个角色会话"],
          ["通知", "Android 后台通知由原生服务负责"]
        ].map(([title, detail]) => (
          <div key={title} className="flex items-center justify-between gap-5 p-5">
            <div>
              <h2 className="font-medium text-white">{title}</h2>
              <p className="mt-1 text-sm text-white/42">{detail}</p>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">规划中</span>
          </div>
        ))}
      </div>
    </section>
  );
}
