import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalReel, extractReels, matchPlaces } from '../src/shared-reels.js';

test('Instagram share text normalizes tracking parameters and duplicate URLs', () => {
  assert.deepEqual(extractReels('여기 가보자 https://www.instagram.com/reel/ABC_12-/?igsh=tracking\nhttps://m.instagram.com/reels/ABC_12-/'), ['https://www.instagram.com/reel/ABC_12-/']);
  assert.equal(canonicalReel('https://instagram.com/p/Post12/#tracking'), 'https://www.instagram.com/p/Post12/');
});

test('rejects deceptive hosts, credentials and unsupported routes', () => {
  for (const url of ['javascript:alert(1)', 'http://instagram.com/reel/ABC/', 'https://instagram.com.evil.test/reel/ABC/', 'https://instagram.com@evil.test/reel/ABC/', 'https://user@instagram.com/reel/ABC/', 'https://instagram.com:444/reel/ABC/', 'https://instagram.com/stories/ABC/', 'https://instagram.com/reel/ABC/extra/', null]) assert.equal(canonicalReel(url), null);
});

test('matches an existing restaurant by reel without relying on title guesses', () => {
  const places = [{id:1,reels:[{url:'https://instagram.com/reel/ABC/?igsh=x'}]}, {id:2,reels:[{url:'https://instagram.com/reel/XYZ/'}]}];
  assert.deepEqual(matchPlaces('https://m.instagram.com/reels/ABC/', places).map(p=>p.id), [1]);
  assert.deepEqual(matchPlaces('https://evil.test/reel/ABC/', places), []);
});
