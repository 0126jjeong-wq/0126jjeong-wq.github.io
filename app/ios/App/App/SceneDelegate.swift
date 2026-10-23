import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ReelsBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}


final class ReelsBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SharedReelsPlugin())
    }
}

@objc(SharedReelsPlugin)
final class SharedReelsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "SharedReelsPlugin"
    let jsName = "SharedReels"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]
    private let shared = UserDefaults(suiteName: "group.com.myreelsmap.app")
    @objc func setAccount(_ call: CAPPluginCall) {
        let id = call.getString("userId") ?? ""
        if UUID(uuidString: id) != nil {
            shared?.set(id, forKey: "memberId")
            shared?.set(call.getDouble("expiresAt") ?? 0, forKey: "memberUntil")
        } else {
            shared?.removeObject(forKey: "memberId")
            shared?.removeObject(forKey: "memberUntil")
        }
        call.resolve()
    }
    private var inboxKey: String? {
        guard let id = shared?.string(forKey: "memberId"),
              (shared?.double(forKey: "memberUntil") ?? 0) > Date().timeIntervalSince1970 else { return nil }
        return "sharedReels." + id
    }
    @objc func list(_ call: CAPPluginCall) {
        guard let key = inboxKey else { call.resolve(["urls": [String]()]); return }
        call.resolve(["urls": shared?.stringArray(forKey: key) ?? []])
    }
    @objc func remove(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), let key = inboxKey else { call.reject("Login required"); return }
        let urls = shared?.stringArray(forKey: key) ?? []
        shared?.set(urls.filter { $0 != url }, forKey: key)
        call.resolve()
    }
}
