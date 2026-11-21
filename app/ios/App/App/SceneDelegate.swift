import UIKit
import Capacitor
import KakaoMapsSDK
import CoreLocation

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

private final class KakaoMapPassthroughHostView: UIView {
    var passthroughRects: [CGRect] = [] {
        didSet { updateMask() }
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if passthroughRects.contains(where: { $0.contains(point) }) { return nil }
        return super.hitTest(point, with: event)
    }

    private func updateMask() {
        let path = UIBezierPath(rect: bounds)
        passthroughRects.forEach { path.append(UIBezierPath(rect: $0)) }
        let mask = CAShapeLayer()
        mask.frame = bounds
        mask.path = path.cgPath
        mask.fillRule = .evenOdd
        layer.mask = mask
    }
}

final class ReelsBridgeViewController: CAPBridgeViewController, MapControllerDelegate, KakaoMapEventDelegate {
    private var kakaoMapContainer: KMViewContainer?
    private var kakaoMapHostView: KakaoMapPassthroughHostView?
    private var kakaoMapController: KMController?
    private var pendingPlaces: [[String: Any]] = []
    private var pendingCenter = CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.978)
    private var pendingZoom = 13
    private var mapFrame = CGRect.zero
    private var mapCutouts: [CGRect] = []
    private var visiblePlaceIDs: [String: String] = [:]

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SharedReelsPlugin())
        bridge?.registerPluginInstance(KakaoNativeMapPlugin())
    }

    func updateKakaoMap(frame: CGRect, cutouts: [CGRect], places: [[String: Any]]) {
        DispatchQueue.main.async {
            self.mapFrame = frame
            self.mapCutouts = cutouts.map { $0.offsetBy(dx: -frame.minX, dy: -frame.minY) }
            self.pendingPlaces = places
            guard let container = self.kakaoMapContainer, let host = self.kakaoMapHostView else {
                let host = KakaoMapPassthroughHostView(frame: frame)
                host.backgroundColor = .clear
                host.passthroughRects = self.mapCutouts
                let container = KMViewContainer(frame: host.bounds)
                container.backgroundColor = .clear
                host.addSubview(container)
                self.kakaoMapHostView = host
                self.kakaoMapContainer = container
                self.view.addSubview(host)
                let controller = KMController(viewContainer: container)
                self.kakaoMapController = controller
                controller.delegate = self
                controller.prepareEngine()
                // The native map host is created after the Capacitor view has appeared,
                // so viewWillAppear may already have run before the engine existed.
                controller.activateEngine()
                return
            }
            host.frame = frame
            host.passthroughRects = self.mapCutouts
            container.frame = host.bounds
            host.isHidden = frame.isEmpty
            if !frame.isEmpty { self.view.bringSubviewToFront(host) }
            self.refreshNativePlaces()
        }
    }

    func moveMap(latitude: Double, longitude: Double, webLevel: Int?) {
        DispatchQueue.main.async {
            let point = MapPoint(longitude: longitude, latitude: latitude)
            let map = self.kakaoMapController?.getView("reelsmap") as? KakaoMap
            // The JavaScript map level increases when zooming out. The iOS SDK is the reverse.
            let zoom = webLevel.map { max(0, min(21, 21 - $0)) } ?? map?.zoomLevel ?? self.pendingZoom
            self.pendingCenter = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            self.pendingZoom = zoom
            guard let map else { return }
            map.moveCamera(CameraUpdate.make(target: point, zoomLevel: zoom, mapView: map))
        }
    }

    func fitMap(points: [[String: Double]], padding: Double) {
        let coords = points.compactMap { item -> CLLocationCoordinate2D? in
            guard let lat = item["lat"], let lng = item["lng"], lat.isFinite, lng.isFinite else { return nil }
            return CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }
        guard !coords.isEmpty else { return }
        let minLat = coords.map(\.latitude).min()!, maxLat = coords.map(\.latitude).max()!
        let minLng = coords.map(\.longitude).min()!, maxLng = coords.map(\.longitude).max()!
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
        let span = max(maxLat - minLat, (maxLng - minLng) * cos(center.latitude * .pi / 180))
        let webLevel = max(6, min(18, Int(ceil(log2(max(span, 0.001) / 0.006))) + 4))
        moveMap(latitude: center.latitude, longitude: center.longitude, webLevel: webLevel)
    }

    private func refreshNativePlaces() {
        guard let map = kakaoMapController?.getView("reelsmap") as? KakaoMap,
              let layer = map.getLabelManager().getLabelLayer(layerID: "reelsmap-places") else { return }
        let oldIDs = layer.getAllPois()?.map { $0.itemID } ?? []
        if !oldIDs.isEmpty { layer.removePois(poiIDs: oldIDs) }
        visiblePlaceIDs = [:]
        for (index, place) in pendingPlaces.enumerated() {
            guard let lat = place["lat"] as? Double, let lng = place["lng"] as? Double,
                  lat.isFinite, lng.isFinite else { continue }
            let id = String(describing: place["id"] ?? index)
            let poiID = "reelsmap-poi-\(index)"
            let option = PoiOptions(styleID: "reelsmap-pin", poiID: poiID)
            option.clickable = true
            option.rank = 1
            let label = String(describing: place["label"] ?? "맛집")
            option.addText(PoiText(text: String(label.prefix(16)), styleIndex: 0))
            guard let poi = layer.addPoi(option: option, at: MapPoint(longitude: lng, latitude: lat)) else { continue }
            poi.userObject = id as NSString
            poi.show()
            visiblePlaceIDs[poiID] = id
        }
    }

    // MARK: Kakao Maps SDK lifecycle
    func authenticationSucceeded() {
        NSLog("Kakao Maps native authentication succeeded")
    }

    func authenticationFailed(_ errorCode: Int, desc: String) {
        NSLog("Kakao Maps native authentication failed: %d %@", errorCode, desc)
        bridge?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('reelsmap:native-map-error',{detail:{code:\(errorCode)}}))")
    }

    func addViews() {
        let point = MapPoint(longitude: pendingCenter.longitude, latitude: pendingCenter.latitude)
        kakaoMapController?.addView(MapviewInfo(viewName: "reelsmap", viewInfoName: "map", defaultPosition: point, defaultLevel: pendingZoom))
    }

    func addViewSucceeded(_ viewName: String, viewInfoName: String) {
        guard let map = kakaoMapController?.getView("reelsmap") as? KakaoMap else { return }
        map.eventDelegate = self
        let manager = map.getLabelManager()
        let layer = LabelLayerOptions(layerID: "reelsmap-places", competitionType: .none, competitionUnit: .symbolFirst, orderType: .rank, zOrder: 1000)
        _ = manager.addLabelLayer(option: layer)
        let markerImage = Self.makeMarkerImage()
        let icon = PoiIconStyle(symbol: markerImage, anchorPoint: CGPoint(x: 0.5, y: 1.0))
        let textStyle = TextStyle(fontSize: 12, fontColor: .black, strokeThickness: 2, strokeColor: .white)
        let text = PoiTextStyle(textLineStyles: [PoiTextLineStyle(textStyle: textStyle)])
        text.textLayouts = [.bottom]
        manager.addPoiStyle(PoiStyle(styleID: "reelsmap-pin", styles: [PerLevelPoiStyle(iconStyle: icon, textStyle: text, level: 0)]))
        map.viewRect = CGRect(origin: .zero, size: mapFrame.size)
        refreshNativePlaces()
    }

    func addViewFailed(_ viewName: String, viewInfoName: String) {
        NSLog("Kakao Maps view creation failed: %@", viewName)
    }

    func containerDidResized(_ size: CGSize) {
        (kakaoMapController?.getView("reelsmap") as? KakaoMap)?.viewRect = CGRect(origin: .zero, size: size)
    }

    func viewWillDestroyed(_ view: ViewBase) {}

    func kakaoMapDidTapped(kakaoMap: KakaoMap, point: CGPoint) {
        let position = kakaoMap.getPosition(point)
        bridge?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('reelsmap:native-map-tap',{detail:{lat:\(position.wgsCoord.latitude),lng:\(position.wgsCoord.longitude)}}))")
    }

    func cameraDidStopped(kakaoMap: KakaoMap, by: MoveBy) {
        bridge?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('reelsmap:native-zoom',{detail:{level:\(21 - kakaoMap.zoomLevel)}}))")
    }

    func poiDidTapped(kakaoMap: KakaoMap, layerID: String, poiID: String, position: MapPoint) {
        guard let placeID = visiblePlaceIDs[poiID] else { return }
        let payload = try? JSONSerialization.data(withJSONObject: ["id": placeID])
        let json = payload.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        bridge?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('reelsmap:native-marker-tap',{detail:\(json)}))")
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if kakaoMapController?.isEngineActive == false { kakaoMapController?.activateEngine() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        kakaoMapController?.pauseEngine()
    }

    private static func makeMarkerImage() -> UIImage {
        let size = CGSize(width: 36, height: 44)
        return UIGraphicsImageRenderer(size: size).image { context in
            let circle = CGRect(x: 2, y: 1, width: 32, height: 32)
            UIColor(red: 1, green: 0.29, blue: 0.20, alpha: 1).setFill()
            context.cgContext.fillEllipse(in: circle)
            UIColor.white.setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 10, y: 9, width: 16, height: 16))
            UIColor(red: 1, green: 0.29, blue: 0.20, alpha: 1).setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 15, y: 14, width: 6, height: 6))
            let path = UIBezierPath()
            path.move(to: CGPoint(x: 10, y: 27)); path.addLine(to: CGPoint(x: 18, y: 43)); path.addLine(to: CGPoint(x: 26, y: 27)); path.close()
            UIColor(red: 1, green: 0.29, blue: 0.20, alpha: 1).setFill(); path.fill()
        }
    }
}

@objc(KakaoNativeMapPlugin)
final class KakaoNativeMapPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "KakaoNativeMapPlugin"
    let jsName = "KakaoNativeMap"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "move", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bounds", returnType: CAPPluginReturnPromise)
    ]

    @objc func update(_ call: CAPPluginCall) {
        guard let rect = call.getObject("rect"), let x = rect["x"] as? Double,
              let y = rect["y"] as? Double, let width = rect["width"] as? Double,
              let height = rect["height"] as? Double,
              let controller = bridge?.viewController as? ReelsBridgeViewController,
              let webView = bridge?.webView else {
            call.reject("Kakao map view is unavailable")
            return
        }
        let cssRect = CGRect(x: x, y: y, width: width, height: height)
        let frame = webView.convert(cssRect, to: controller.view)
        let cutouts = call.getArray("cutouts", [String: Double].self) ?? []
        let nativeCutouts = cutouts.compactMap { cutout -> CGRect? in
            guard let x = cutout["x"], let y = cutout["y"], let width = cutout["width"], let height = cutout["height"] else { return nil }
            return webView.convert(CGRect(x: x, y: y, width: width, height: height), to: controller.view)
        }
        let places = call.getArray("places", [String: Any].self) ?? []
        controller.updateKakaoMap(frame: frame, cutouts: nativeCutouts, places: places)
        call.resolve()
    }

    @objc func move(_ call: CAPPluginCall) {
        guard let controller = bridge?.viewController as? ReelsBridgeViewController,
              let lat = call.getDouble("lat"), let lng = call.getDouble("lng") else {
            call.reject("Invalid map position")
            return
        }
        controller.moveMap(latitude: lat, longitude: lng, webLevel: call.getInt("level"))
        call.resolve()
    }

    @objc func bounds(_ call: CAPPluginCall) {
        guard let controller = bridge?.viewController as? ReelsBridgeViewController else { call.reject("Kakao map view is unavailable"); return }
        let points = call.getArray("points", [String: Double].self) ?? []
        controller.fitMap(points: points, padding: call.getDouble("padding") ?? 0)
        call.resolve()
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
        guard let id = shared?.string(forKey: "memberId"), (shared?.double(forKey: "memberUntil") ?? 0) > Date().timeIntervalSince1970 else { return nil }
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
