// Shared by the website and bundled iOS app. No guest or cross-account cache.
export function createMemberLibrary(client) {
  let owner = null, version = 0;
  const context = () => { if (!owner) throw new Error('회원가입과 로그인이 필요해요.'); return owner; };
  return {
    get owner() { return owner; },
    setOwner(id) { owner = id || null; version++; },
    async load() {
      const id = context(), started = version;
      const [saves, reels] = await Promise.all([
        client.from('user_saved_restaurants').select('restaurant_id').eq('user_id', id),
        client.from('user_reel_library').select('url,place').eq('user_id', id)
      ]);
      if (saves.error || reels.error) throw saves.error || reels.error;
      if (owner !== id || started !== version) return null;
      return { saved: (saves.data || []).map(r => String(r.restaurant_id)), reels: reels.data || [] };
    },
    async saveRestaurant(restaurantId) {
      const id = context();
      const { error } = await client.from('user_saved_restaurants').upsert({user_id:id,restaurant_id:restaurantId}, {onConflict:'user_id,restaurant_id',ignoreDuplicates:true});
      if (error) throw error;
    },
    async removeRestaurant(restaurantId) {
      const id = context();
      const { error } = await client.from('user_saved_restaurants').delete().eq('user_id',id).eq('restaurant_id',restaurantId);
      if (error) throw error;
      const { error: reelError } = await client.from('user_reel_library').delete().eq('user_id',id).eq('place->>id',String(restaurantId));
      if (reelError) throw reelError;
    },
    async saveReel(url, place) {
      const id = context();
      // Inbox import must not erase an existing restaurant connection.
      const options = {onConflict:'user_id,url',ignoreDuplicates:place === undefined};
      const { error } = await client.from('user_reel_library').upsert({user_id:id,url,...(place === undefined ? {} : {place})},options);
      if (error) throw error;
    },
    async removeReel(url) {
      const id = context();
      const { error } = await client.from('user_reel_library').delete().eq('user_id',id).eq('url',url);
      if (error) throw error;
    }
  };
}
