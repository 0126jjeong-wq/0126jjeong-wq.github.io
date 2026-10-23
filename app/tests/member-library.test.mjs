import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/member-library.js',import.meta.url),'utf8');
const {createMemberLibrary}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function fakeClient(reply=()=>({data:[],error:null})){
  const calls=[];
  return {calls,from(table){const call={table,filters:[]};calls.push(call);const q={select(){return q},eq(...filter){call.filters.push(filter);return q},upsert(row,options){Object.assign(call,{row,options});return q},delete(){call.delete=true;return q},then(ok,fail){return Promise.resolve(reply(call)).then(ok,fail)}};return q;}};
}
test('guests cannot read or mutate any member data',async()=>{
 const c=fakeClient(),library=createMemberLibrary(c);
 for(const work of [()=>library.load(),()=>library.saveRestaurant('r'),()=>library.removeRestaurant('r'),()=>library.saveReel('url'),()=>library.removeReel('url')])await assert.rejects(work,/로그인/);
 assert.equal(c.calls.length,0);
});
test('all reads and deletes constrain the current owner; inbox imports retain existing connections',async()=>{
 const c=fakeClient(),library=createMemberLibrary(c);library.setOwner('A');
 await library.load();await library.removeRestaurant('r');await library.removeReel('url');
 assert.ok(c.calls.every(c=>c.filters.some(([key,value])=>key==='user_id'&&value==='A')));
 await library.saveReel('url');assert.equal(c.calls.at(-1).options.ignoreDuplicates,true);assert.equal(c.calls.at(-1).row.user_id,'A');
 await library.saveReel('url',{id:'r'});assert.equal(c.calls.at(-1).options.ignoreDuplicates,false);
 library.setOwner('B');await library.saveRestaurant('r');assert.equal(c.calls.at(-1).row.user_id,'B');
});
test('a delayed account A response is discarded after switching accounts or logging out',async()=>{
 let resolve;const wait=new Promise(r=>resolve=r),c=fakeClient(()=>wait),library=createMemberLibrary(c);
 library.setOwner('A');const loading=library.load();library.setOwner('B');resolve({data:[{restaurant_id:'private-A'}],error:null});assert.equal(await loading,null);
 library.setOwner(null);await assert.rejects(()=>library.saveRestaurant('r'),/로그인/);
});
test('network or RLS failures propagate instead of claiming a successful save',async()=>{
 const denied=new Error('RLS denied'),c=fakeClient(()=>({error:denied})),library=createMemberLibrary(c);library.setOwner('A');
 await assert.rejects(()=>library.saveRestaurant('r'),/RLS denied/);await assert.rejects(()=>library.load(),/RLS denied/);
});
