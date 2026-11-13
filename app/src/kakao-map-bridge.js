(() => {
  const origins = new Set(["https://myreelsmap.com", "https://www.myreelsmap.com"]);
  const fallback = window.kakao.maps;
  const frames = new WeakMap();
  window.switchKakaoMapToFallback = element => {
    const connection = frames.get(element);
    connection?.frame.remove();
    element.replaceChildren();
    window.kakao.maps = fallback;
    return fallback;
  };

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

  window.prepareKakaoMap = element => new Promise(resolve => {
    const frame = document.createElement("iframe");
    const channel = crypto.randomUUID();
    frame.title = "카카오 맛집 지도";
    frame.sandbox = "allow-scripts allow-same-origin";
    frame.style.cssText = "display:block;width:100%;height:100%;border:0";
    const connection = {
      frame,
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
      resolve(fallback);
    }
    function receive(event) {
      if (!origins.has(event.origin) || event.source !== frame.contentWindow || event.data?.channel !== channel) return;
      connection.targetOrigin = event.origin;
      if (event.data.type === "unavailable") return fail();
      if (event.data.type === "tiles-unavailable") {
        window.dispatchEvent(new Event("reelsmap:map-tiles-unavailable"));
        return;
      }
      if (event.data.type === "ready" && !ready) {
        ready = true;
        clearTimeout(timeout);
        frames.set(element, connection);
        resolve({
          ...fallback,
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
