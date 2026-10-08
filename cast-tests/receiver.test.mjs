import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTrack, playbackView, formatTime } from '../web/public/cast/model.mjs';

const items = [{ itemId: 1, media: { contentId: 'same' } }, { itemId: 2, media: { contentId: 'same' } }];
test('up next uses queue occurrence identity, including duplicate songs', () => {
  assert.equal(nextTrack(items, 1, 'REPEAT_OFF'), items[1]);
  assert.equal(nextTrack(items, 2, 'REPEAT_OFF'), null);
  assert.equal(nextTrack(items, 2, 'REPEAT_ALL'), items[0]);
  assert.equal(nextTrack(items, 1, 'REPEAT_SINGLE'), items[0]);
  assert.equal(nextTrack(items, 99, 'REPEAT_ALL'), null);
});
test('next track is revealed only in the final ten seconds', () => {
  assert.equal(playbackView(79, 90, 'PLAYING', items[1]).showNext, false);
  assert.equal(playbackView(80, 90, 'PLAYING', items[1]).showNext, true);
  assert.equal(playbackView(80, 90, 'PAUSED', items[1]).animate, false);
  assert.equal(playbackView(90, 90, 'IDLE', null).showNext, false);
});
test('unknown duration and invalid time never produce invalid progress', () => {
  assert.equal(playbackView(10, NaN, 'BUFFERING', null).progress, 0);
  assert.equal(playbackView(-2, 90, 'PLAYING', null).progress, 0);
  assert.equal(playbackView(100, 90, 'PLAYING', null).progress, 1);
});
test('time labels remain readable before metadata arrives and for long tracks', () => {
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(-3), '0:00');
  assert.equal(formatTime(75.9), '1:15');
  assert.equal(formatTime(3601), '60:01');
});
