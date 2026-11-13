// Map adapter for app and preview origins where the Kakao web SDK cannot run.
// Place data and route links still come from the existing service.
(() => {
  const toLeafletLevel = level => Math.max(3, Math.min(18, 19 - Number(level)));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  class MapAdapter {
    constructor(element, options) {
      this.instance = L.map(element, { zoomControl: false, scrollWheelZoom: true })
        .setView([options.center.lat, options.center.lng], toLeafletLevel(options.level));
      L.control.zoom({ position: 'bottomleft' }).addTo(this.instance);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.instance);
    }
    setMinLevel(level) { this.instance.setMaxZoom(toLeafletLevel(level)); }
    setMaxLevel(level) { this.instance.setMinZoom(toLeafletLevel(level)); }
    addControl() {}
    panTo(point) { this.instance.panTo([point.lat, point.lng], { animate: !reducedMotion.matches }); }
    moveTo(point, level) {
      const center = [point.lat, point.lng];
      const zoom = toLeafletLevel(level);
      this.instance.stop();
      if (reducedMotion.matches) this.instance.setView(center, zoom, { animate: false });
      else if (zoom === this.instance.getZoom()) this.instance.panTo(center, { animate: true, duration: 0.25 });
      else this.instance.flyTo(center, zoom, { duration: 0.4 });
    }
    setCenter(point) { this.instance.setView([point.lat, point.lng], this.instance.getZoom()); }
    setLevel(level) { this.instance.setZoom(toLeafletLevel(level)); }
    getLevel() { return 19 - this.instance.getZoom(); }
    setBounds(bounds) { this.instance.fitBounds(bounds.points, { padding: [35, 35], maxZoom: 15, animate: !reducedMotion.matches }); }
    relayout() { this.instance.invalidateSize({ pan: false }); }
  }
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
  }
  class LatLngBounds {
    constructor() { this.points = []; }
    extend(point) { this.points.push([point.lat, point.lng]); }
  }
  class CustomOverlay {
    constructor({ map, position, content, zIndex = 1 }) {
      this.position = position;
      this.content = content;
      this.zIndex = zIndex;
      L.DomEvent.disableClickPropagation(content);
      if (map) this.setMap(map);
    }
    setMap(map) {
      if (this.marker && this.map) this.map.instance.removeLayer(this.marker);
      this.map = map;
      if (!map) return;
      this.marker = L.marker([this.position.lat, this.position.lng], {
        keyboard: false,
        zIndexOffset: this.zIndex * 10,
        icon: L.divIcon({ html: this.content, className: 'reels-map-overlay', iconSize: [50, 50], iconAnchor: [25, 50] })
      }).addTo(map.instance);
    }
  }
  window.kakao = { maps: {
    load: callback => callback(),
    Map: MapAdapter, LatLng, LatLngBounds, CustomOverlay,
    MapTypeControl: class {}, ZoomControl: class {}, ControlPosition: { TOPRIGHT: 1, RIGHT: 2 },
    event: { addListener(map, name, callback) { map.instance.on(name === 'zoom_changed' ? 'zoomend' : name,
      event => callback(event.latlng ? { latLng: event.latlng } : event)); }, preventMap() {} }
  } };
})();
