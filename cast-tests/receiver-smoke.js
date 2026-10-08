// Run with playwright-cli run-code --filename=cast-tests/receiver-smoke.js against the local preview server.
async page => {
  await page.route('https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js', route => route.fulfill({
    contentType: 'text/javascript', body: `
      window.fixture = { position: 50, duration: 90, state: 'PLAYING', id: 1, events: {} };
      const items = [1, 2].map(id => ({ itemId: id, media: { contentId: 'same-song', metadata: { title: 'Song occurrence ' + id, artist: 'Test artist' } } }));
      const queue = { getItems: () => items, getCurrentItem: () => items.find(item => item.itemId === fixture.id) };
      const player = {
        getQueueManager: () => queue, getCurrentTimeSec: () => fixture.position,
        getDurationSec: () => fixture.duration, getPlayerState: () => fixture.state,
        getMediaInformation: () => queue.getCurrentItem().media,
        setMessageInterceptor: (type, callback) => { fixture.status = callback; },
        addEventListener: (type, callback) => { fixture.events[type] = callback; }
      };
      window.cast = { framework: {
        CastReceiverContext: { getInstance: () => ({ getPlayerManager: () => player, start: options => { fixture.started = options.mediaElement.id; } }) },
        messages: { MessageType: { MEDIA_STATUS: 'MEDIA_STATUS' } }, events: { EventType: { ERROR: 'ERROR' } }
      } };
    `
  }));
  await page.goto('http://127.0.0.1:8100/cast/index.html');
  await page.waitForFunction(() => document.getElementById('title').textContent === 'Song occurrence 1');
  if (await page.locator('#up-next').isVisible()) throw new Error('Up Next shown too early');
  await page.evaluate(() => { fixture.position = 85; });
  await page.waitForFunction(() => !document.getElementById('up-next').hidden);
  if (await page.locator('#next-title').textContent() !== 'Song occurrence 2') throw new Error('Duplicate queue occurrence lost');
  await page.evaluate(() => { fixture.state = 'PAUSED'; });
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Paused');
  await page.evaluate(() => { fixture.id = 2; fixture.status({ repeatMode: 'REPEAT_ALL' }); });
  await page.waitForFunction(() => document.getElementById('next-title').textContent === 'Song occurrence 1');
  await page.evaluate(() => { fixture.events.ERROR(); });
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Unable to play'));
  await page.evaluate(() => { fixture.status({ repeatMode: 'REPEAT_OFF' }); fixture.state = 'IDLE'; fixture.position = 90; });
  await page.waitForFunction(() => document.getElementById('up-next').hidden);
  if (await page.evaluate(() => fixture.started) !== 'media') throw new Error('Wrong media element');
  console.log('PASS: receiver startup, metadata, duplicate Up Next, pause, repeat, errors and queue end');
}
