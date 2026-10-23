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
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]
    private let shared = UserDefaults(suiteName: "group.com.myreelsmap.app")
    @objc func list(_ call: CAPPluginCall) {
        call.resolve(["urls": shared?.stringArray(forKey: "sharedReels") ?? []])
    }
    @objc func remove(_ call: CAPPluginCall) {
        guard let url = call.getString("url") else { call.reject("Missing URL"); return }
        let urls = shared?.stringArray(forKey: "sharedReels") ?? []
        shared?.set(urls.filter { $0 != url }, forKey: "sharedReels")
        call.resolve()
    }
}
