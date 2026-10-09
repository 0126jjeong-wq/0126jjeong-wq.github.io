import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';

const native = Capacitor.isNativePlatform();
window.ReelsNative = {
  enabled: native,
  async getPosition() {
    const status = await Geolocation.checkPermissions();
    if (status.location !== 'granted') await Geolocation.requestPermissions();
    return Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  },
  async open(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['www.instagram.com', 'instagram.com', 'map.kakao.com', 'myreelsmap.com'].includes(parsed.hostname)) return;
    await Browser.open({ url: parsed.toString() });
  },
  async share(data) { await Share.share(data); }
};
