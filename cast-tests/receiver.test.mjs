import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTrack, playbackView } from '../web/public/cast/model.mjs';

const items = [{ itemId: 1, media: { contentId: 'same' } }, { itemId: 2, media: { contentId: 'same' } }];
test('up next uses queue occurrence identity, including duplicate songs', () => {
  assert.equal(nextTrack(items, 1, 'REPEAT_OFF'), items[1]);
  assert.equal(nextTrack(items, 2, 'REPEAT_OFF'), null);
  assert.equal(nextTrack(items, 2, 'REPEAT_ALL'), items[0]);
  assert.equal(nextTrack(items, 1, 'REPEAT_SINGLE'), items[0]);
  assert.equal(nextTrack(items, 99, 'REPEAT_ALL'), null);
});
test('next track is revealed only in the final twenty seconds', () => {
  assert.equal(playbackView(69, 90, 'PLAYING', items[1]).showNext, false);
  assert.equal(playbackView(70, 90, 'PLAYING', items[1]).showNext, true);
  assert.equal(playbackView(70, 90, 'PAUSED', items[1]).animate, false);
  assert.equal(playbackView(90, 90, 'IDLE', null).showNext, false);
});
test('unknown duration and invalid time never produce invalid progress', () => {
  assert.equal(playbackView(10, NaN, 'BUFFERING', null).progress, 0);
  assert.equal(playbackView(-2, 90, 'PLAYING', null).progress, 0);
  assert.equal(playbackView(100, 90, 'PLAYING', null).progress, 1);
});
