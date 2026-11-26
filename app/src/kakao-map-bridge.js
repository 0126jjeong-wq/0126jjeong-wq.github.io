(() => {
  if (window.ReelsNative?.enabled && window.KakaoNativeMap) {
    const plugin = window.KakaoNativeMap;
    window.kakao ??= {};
    let nextMapId = 0;
    let activeNativeMap = null;
    class LatLng {
      constructor(lat, lng) { this.lat = Number(lat); this.lng = Number(lng); }
      getLat() { return this.lat; }
      getLng() { return this.lng; }
    }
    class LatLngBounds {
      constructor() { this.points = []; }
      extend(point) { this.points.push({ lat: point.lat, lng: point.lng }); }
    }
    class NativeMap {
      constructor(element, options = {}) {
        this.id = ++nextMapId;
        this.element = element;
        this.level = options.level ?? 8;
        this.listeners = new Map();
        this.overlays = new Map();
        this.nextOverlayId = 0;
        this.syncTimer = 0;
        this.onMarkerTap = ({ detail }) => {
          if (activeNativeMap !== this) return;
          const overlay = this.overlays.get(String(detail?.id));
          overlay?.content?.click();
        };
        this.onMapTap = ({ detail }) => {
          if (activeNativeMap !== this) return;
          const latLng = detail && Number.isFinite(detail.lat) && Number.isFinite(detail.lng)
            ? new LatLng(detail.lat, detail.lng) : undefined;
          this.emit("click", latLng ? { latLng } : undefined);
        };
        this.onNativeZoom = ({ detail }) => {
          if (activeNativeMap !== this) return;
          const nextLevel = Math.max(1, Math.min(21, Number(detail?.level ?? 8)));
          if (nextLevel === this.level) return;
          this.level = nextLevel;
          this.emit("zoom_changed");
        };
        window.addEventListener("reelsmap:native-marker-tap", this.onMarkerTap);
        window.addEventListener("reelsmap:native-map-tap", this.onMapTap);
        window.addEventListener("reelsmap:native-zoom", this.onNativeZoom);
        this.onDialogChange = () => this.scheduleSync();
        document.addEventListener("close", this.onDialogChange, true);
        document.addEventListener("cancel", this.onDialogChange, true);
        this.dialogObserver = new MutationObserver(this.onDialogChange);
        this.dialogObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
        this.resizeObserver = new ResizeObserver(() => this.scheduleSettledSync());
        this.resizeObserver.observe(element);
        this.onViewportChange = () => this.scheduleSettledSync();
        window.addEventListener("resize", this.onViewportChange, { passive: true });
        window.addEventListener("scroll", this.onViewportChange, { passive: true, capture: true });
        window.visualViewport?.addEventListener("resize", this.onViewportChange, { passive: true });
        window.visualViewport?.addEventListener("scroll", this.onViewportChange, { passive: true });
        this.viewObserver = new MutationObserver(() => this.scheduleSettledSync());
        this.viewObserver.observe(document.body, { attributes: true, attributeFilter: ["data-view"] });
        window.addEventListener("pageshow", this.onViewportChange);
        this.scheduleSettledSync();
        this.setCenter(options.center || new LatLng(37.5665, 126.978));
        this.scheduleSync();
      }
      addControl() {}
      setMinLevel() {}
      setMaxLevel() {}
      getLevel() { return this.level; }
      setLevel(level) { this.level = Number(level); this.call("move", { lat: this.center.lat, lng: this.center.lng, level: this.level }); }
      setCenter(point) { this.center = point; this.call("move", { lat: point.lat, lng: point.lng, level: this.level }); }
      moveTo(point, level) {
        this.center = point;
        if (Number.isFinite(Number(level))) this.level = Number(level);
        this.call("move", { lat: point.lat, lng: point.lng, level: this.level });
      }
      setBounds(bounds) {
        const points = bounds?.points || [];
        if (points.length) this.call("bounds", { points, padding: 48 });
      }
      relayout() { this.scheduleSync(); }
      addListener(name, callback) {
        if (!this.listeners.has(name)) this.listeners.set(name, []);
        this.listeners.get(name).push(callback);
      }
      emit(name, value) { for (const callback of this.listeners.get(name) || []) callback(value); }
      call(method, payload = {}) { return plugin[method](payload).catch(error => console.error("Kakao Maps SDK", error)); }
      scheduleSync() {
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => this.sync(), 70);
      }
      scheduleSettledSync() {
        this.scheduleSync();
        [180, 520, 1050].forEach(delay => setTimeout(() => this.sync(), delay));
      }
      sync() {
        if (!this.element.isConnected) return;
        const picker = this.element.id === "privatePlaceMap";
        const pickerDialog = document.querySelector("#connectReelDialog");
        if (picker && (!pickerDialog?.open || !pickerDialog.querySelector("details")?.open)) return;
        if (!picker && pickerDialog?.open) return;
        activeNativeMap = this;
        const rect = this.element.getBoundingClientRect();
        const modalOpen = Boolean(document.querySelector("dialog[open]"));
        const cutouts = [...document.querySelectorAll(".map-card, #mapCategoryFilter, .map-tools .map-tool, #placeSheet, #mapError, #connectReelDialog")]
          .map(control => control.getBoundingClientRect())
          .filter(control => control.width > 0 && control.height > 0 && control.right > rect.left && control.left < rect.right && control.bottom > rect.top && control.top < rect.bottom)
          .map(control => ({ x: control.left, y: control.top, width: control.width, height: control.height }));
        const places = [];
        for (const [id, overlay] of this.overlays) {
          const label = overlay.content?.getAttribute?.("aria-label") || overlay.content?.title || "";
          if (!label) continue;
          const isLocation = label === "내 위치";
          const isCluster = overlay.content?.classList?.contains("map-cluster") || false;
          const placeId = overlay.content?.dataset?.placeId || id;
          const restaurant = isLocation ? null : window.mapRestaurantById?.get(String(placeId));
          const bestViews = Math.max(0, ...(restaurant?.reels || []).map(reel => Number(reel.signal?.view_count) || 0));
          places.push({ id: placeId, overlayID: String(id), label: isLocation ? "내 위치" : label.replace(/ · .* 지도 마커$/, ""), location: isLocation, category: restaurant?.category || "식사", views: bestViews, cluster: isCluster, count: isCluster ? Number(overlay.content.textContent) || 0 : 0, details: this.level <= 6, lat: overlay.position.lat, lng: overlay.position.lng });
        }
        this.call("update", { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, cutouts, places, hidden: modalOpen });
      }
    }
    class NativeOverlay {
      constructor(options) {
        this.position = options.position;
        this.content = options.content;
        this.id = String(options.content?.getAttribute?.("data-native-map-id") || "");
        this.map = null;
        this.observer = new MutationObserver(() => this.map?.scheduleSync());
        this.observer.observe(this.content, { attributes: true, childList: true, subtree: true });
        this.setMap(options.map);
      }
      setMap(map) {
        if (this.map) this.map.overlays.delete(this.id);
        this.map = map;
        if (!map) return;
        if (!this.id || map.overlays.has(this.id)) this.id = `overlay-${++map.nextOverlayId}`;
        this.content.setAttribute("data-native-map-id", this.id);
        map.overlays.set(this.id, this);
        map.scheduleSync();
      }
    }
    window.prepareKakaoMap = async element => ({
      Map: NativeMap, LatLng, LatLngBounds, CustomOverlay: NativeOverlay,
      MapTypeControl: class {}, ZoomControl: class {},
      ControlPosition: { TOPRIGHT: 0, RIGHT: 1 },
      event: {
        addListener(map, name, callback) { map.addListener(name, callback); },
        preventMap() {}
      }
    });
    window.addEventListener("reelsmap:native-map-error", () => window.dispatchEvent(new CustomEvent("reelsmap:kakao-tiles-error")));
    return;
  }

  const origins = new Set(["https://myreelsmap.com", "https://www.myreelsmap.com"]);
  const frames = new WeakMap();

  class HostedMap {
    constructor(element, options) {
      this.connection = frames.get(element);
      this.level = options.level;
      this.listeners = new Map();
      this.overlays = new Map();
      this.nextId = 0;
      this.connection.onEvent = ({ type, level, id, point }) => {
        if (type === "zoom_changed") this.level = level;
        if (type === "overlay-click") this.overlays.get(id)?.click();
        for (const callback of this.listeners.get(type) || []) callback(point && { latLng: point });
      };
      this.send("init", options);
    }
    send(type, data = {}) { this.connection.send(type, data); }
    setMinLevel(level) { this.send("min", { level }); }
    setMaxLevel(level) { this.send("max", { level }); }
    addControl() {}
    getLevel() { return this.level; }
    setLevel(level) { this.send("level", { level }); }
    setCenter(point) { this.send("center", { point }); }
    moveTo(point, level) { this.send("move", { point, level, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches }); }
    setBounds(bounds) { this.send("bounds", { points: bounds.points }); }
    relayout() { this.send("resize"); }
  }

  class HostedOverlay {
    constructor(options) {
      this.options = options;
      this.setMap(options.map);
    }
    setMap(map) {
      this.observer?.disconnect();
      if (this.map) {
        this.map.overlays.delete(this.id);
        this.map.send("remove", { id: this.id });
      }
      this.map = map;
      if (!map) return;
      const { position, content, xAnchor, yAnchor, zIndex } = this.options;
      this.id = ++map.nextId;
      map.overlays.set(this.id, content);
      const sync = () => {
        if (this.map !== map || !map.overlays.has(this.id)) return;
        map.send("overlay", { id: this.id, position, html: content.outerHTML, xAnchor, yAnchor, zIndex });
      };
      this.observer = new MutationObserver(sync);
      this.observer.observe(content, { attributes: true, childList: true, subtree: true });
      sync();
    }
  }

  window.prepareKakaoMap = element => new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    const channel = crypto.randomUUID();
    frame.title = "카카오 맛집 지도";
    frame.sandbox = "allow-scripts allow-same-origin";
    frame.style.cssText = "display:block;width:100%;height:100%;border:0";
    const connection = {
      targetOrigin: null,
      send(type, data) { frame.contentWindow.postMessage({ channel, type, ...data }, this.targetOrigin || "*"); },
      onEvent: null
    };
    let ready = false;
    const timeout = setTimeout(fail, 6500);
    function fail() {
      if (ready) return;
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      frame.remove();
      reject(new Error("카카오 지도를 불러오지 못했습니다."));
    }
    function receive(event) {
      if (!origins.has(event.origin) || event.source !== frame.contentWindow || event.data?.channel !== channel) return;
      connection.targetOrigin = event.origin;
      if (event.data.type === "unavailable") return fail();
      if (event.data.type === "tiles-unavailable") {
        window.dispatchEvent(new CustomEvent("reelsmap:kakao-tiles-error"));
        return;
      }
      if (event.data.type === "ready" && !ready) {
        ready = true;
        clearTimeout(timeout);
        frames.set(element, connection);
        resolve({
          ...window.kakao.maps,
          Map: HostedMap,
          CustomOverlay: HostedOverlay,
          event: {
            preventMap() {},
            addListener(map, name, callback) {
              if (!map.listeners.has(name)) map.listeners.set(name, []);
              map.listeners.get(name).push(callback);
            }
          }
        });
      } else if (ready) connection.onEvent?.(event.data);
    }
    window.addEventListener("message", receive);
    frame.referrerPolicy = "origin";
    frame.src = "https://myreelsmap.com/app-map.html#" + channel;
    element.append(frame);
  });
})();
