import Tauri
import WebKit

class KeepAlivePlugin: Plugin {
  @objc public func background(_ invoke: Invoke) throws {
    invoke.resolve()
  }

  @objc public func start(_ invoke: Invoke) throws {
    invoke.resolve()
  }

  @objc public func stop(_ invoke: Invoke) throws {
    invoke.resolve()
  }

  @objc public func status(_ invoke: Invoke) throws {
    invoke.resolve("unsupported")
  }

  @objc public func handoff(_ invoke: Invoke) throws {
    invoke.resolve(["accessToken": "", "refreshToken": "", "expiresAt": 0, "cursor": 0])
  }
}
