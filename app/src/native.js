import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { createClient } from '@supabase/supabase-js';

import * as ReelsLinks from './shared-reels.js';
window.ReelsLinks = ReelsLinks;

const native = Capacitor.isNativePlatform();
const redirectTo = 'com.myreelsmap.app://auth/callback';
const client = createClient('https://tbyfoxsyadmpeeatyzvm.supabase.co', 'sb_publishable_988pI6RSLYvNDIUEZ1sc3w_ZLlwcRh_', {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'reelsmap-native-session' }
});
let exchanging = false;
let loginInProgress = false;
async function completeLogin(rawUrl) {
  if (!native || exchanging) return;
  let callback;
  try { callback = new URL(rawUrl); } catch { return; }
  if (callback.protocol !== 'com.myreelsmap.app:' || callback.hostname !== 'auth' || callback.pathname !== '/callback') return;
  exchanging = true;
  loginInProgress = false;
  try {
    const params = callback.searchParams;
    const hash = new URLSearchParams(callback.hash.slice(1));
    const error = params.get('error_description') || hash.get('error_description') || params.get('error') || hash.get('error');
    if (error) throw new Error(error);
    const code = params.get('code');
    if (!code) throw new Error('로그인 인증 코드가 없습니다. 다시 시도해 주세요.');
    const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
    window.dispatchEvent(new CustomEvent('reelsmap:auth-result', { detail: { ok: true } }));
  } catch (error) {
    window.dispatchEvent(new CustomEvent('reelsmap:auth-result', { detail: { ok: false, message: error.message } }));
  } finally {
    exchanging = false;
    await Browser.close().catch(() => {});
  }
}
if (native) {
  App.addListener('appUrlOpen', ({ url }) => completeLogin(url));
  Browser.addListener('browserFinished', () => {
    if (!loginInProgress || exchanging) return;
    loginInProgress = false;
    window.dispatchEvent(new CustomEvent('reelsmap:auth-result', { detail: { ok: false, message: '로그인이 취소되었습니다.' } }));
  });
  App.getLaunchUrl().then(result => { if (result?.url) completeLogin(result.url); }).catch(() => {});
}
window.ReelsAuth = {
  client,
  enabled: native,
  async signIn(provider) {
    if (!native) throw new Error('앱에서 로그인할 수 있어요.');
    const { data, error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
    if (error) throw error;
    if (!data?.url) throw new Error('로그인 주소를 받지 못했어요.');
    loginInProgress = true;
    try { await Browser.open({ url: data.url, presentationStyle: 'popover' }); }
    catch (error) { loginInProgress = false; throw error; }
  }
};
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

const SharedReels = registerPlugin('SharedReels');
window.ReelsInbox = {
  enabled: native,
  async list() { return native ? (await SharedReels.list()).urls : []; },
  async remove(url) { if (native) await SharedReels.remove({ url }); }
};
if (native) {
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event('reelsmap:shared-reels'));
  });
}
