import Tauri
import WebKit

class KeepAlivePlugin: Plugin {
  @objc public func start(_ invoke: Invoke) throws {
    invoke.resolve()
  }

  @objc public func stop(_ invoke: Invoke) throws {
    invoke.resolve()
  }

  @objc public func status(_ invoke: Invoke) throws {
    invoke.resolve(["status": "unsupported"])
  }
}
