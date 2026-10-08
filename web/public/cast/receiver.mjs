import { nextTrack, playbackView, formatTime } from './model.mjs';

const $ = id => document.getElementById(id);
const media = $('media');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bars = $('visualizer').getContext('2d');
let analyser, audioContext, samples, state = 'IDLE', playbackError = '';

function setImage(element, url) {
  const safe = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '';
  if (element.getAttribute('src') === safe) return;
  if (safe) element.src = safe;
  else element.removeAttribute('src');
  element.onerror = () => element.removeAttribute('src');
}

// If Web Audio cannot be enabled, leave CAF's audio output untouched.
async function enableAnalysis() {
  if (audioContext || reducedMotion || !window.AudioContext) return;
  try {
    const candidate = new AudioContext();
    await candidate.resume();
    if (candidate.state !== 'running') { await candidate.close(); return; }
    const node = candidate.createAnalyser();
    node.fftSize = 256;
    node.smoothingTimeConstant = .8;
    const source = candidate.createMediaElementSource(media);
    source.connect(candidate.destination);
    source.connect(node);
    audioContext = candidate;
    analyser = node;
    samples = new Uint8Array(node.frequencyBinCount);
  } catch { /* Unsupported hardware keeps standard audio and a quiet visualizer. */ }
}
media.addEventListener('playing', enableAnalysis);
media.addEventListener('loadstart', () => { playbackError = ''; });

function render(mediaInfo, position, duration, next, playerState) {
  state = playerState;
  const meta = mediaInfo?.metadata ?? {};
  const view = playbackView(position, duration, state, next);
  $('title').textContent = meta.title || 'Make yourself at home.';
  $('artist').textContent = meta.artist || 'Choose some music in Anime Ongaku.';
  $('anime').textContent = meta.albumName || meta.albumTitle || 'YOUR SOUNDTRACK';
  $('footer-title').textContent = meta.title ? `${meta.title}${meta.artist ? ' · ' + meta.artist : ''}` : 'A little music. A good evening.';
  setImage($('artwork'), meta.images?.[0]?.url);
  setImage($('backdrop'), meta.images?.[0]?.url);
  $('time').textContent = `${formatTime(position)} / ${formatTime(duration)}`;
  $('progress').style.width = `${view.progress * 100}%`;
  $('status').textContent = playbackError || ({ PLAYING: 'Now playing', PAUSED: 'Paused', BUFFERING: 'Loading music…', IDLE: mediaInfo ? 'Queue finished' : 'Ready to cast' })[state] || 'Ready to cast';
  $('up-next').hidden = !view.showNext;
  if (view.showNext) {
    const metadata = next.media?.metadata ?? {};
    $('next-label').textContent = `UP NEXT · ${Math.ceil(view.remaining)}s`;
    $('next-title').textContent = metadata.title || 'Next track';
    $('next-artist').textContent = metadata.artist || '';
    setImage($('next-art'), metadata.images?.[0]?.url);
  }
}

let lastFrame = 0;
function draw(time) {
  requestAnimationFrame(draw);
  if (time - lastFrame < 50) return;
  lastFrame = time;
  bars.clearRect(0, 0, 640, 100);
  const active = state === 'PLAYING' && !reducedMotion;
  if (active && analyser) analyser.getByteFrequencyData(samples);
  for (let i = 0; i < 48; i++) {
    const level = active && analyser ? samples[2 + i * 2] / 255 : 0;
    const height = 3 + level * 85;
    bars.fillStyle = `rgba(255,154,171,${.25 + level * .65})`;
    bars.fillRect(i * 13, 100 - height, 7, height);
  }
}
requestAnimationFrame(draw);

if (new URLSearchParams(location.search).has('preview')) {
  render({ metadata: { title: 'An evening in color', artist: 'Anime Ongaku', albumName: 'THE PARTY MIX' } }, 85, 90,
    { media: { metadata: { title: 'The next opening', artist: 'Your favorite soundtrack' } } }, 'PLAYING');
} else if (window.cast?.framework) {
  const context = cast.framework.CastReceiverContext.getInstance();
  const player = context.getPlayerManager();
  const queue = player.getQueueManager();
  let repeatMode = 'REPEAT_OFF';
  player.setMessageInterceptor(cast.framework.messages.MessageType.MEDIA_STATUS, message => {
    const status = message.status?.[0] ?? message;
    repeatMode = status.repeatMode ?? status.queueData?.repeatMode ?? repeatMode;
    return message;
  });
  const update = () => {
    render(player.getMediaInformation(), player.getCurrentTimeSec(), player.getDurationSec(),
      nextTrack(queue.getItems(), queue.getCurrentItem()?.itemId, repeatMode), player.getPlayerState());
  };
  player.addEventListener(cast.framework.events.EventType.ERROR, () => {
    playbackError = 'Unable to play this track. Reconnect from your phone.';
  });
  setInterval(update, 500);
  context.start({ mediaElement: media, disableIdleTimeout: false });
} else {
  $('status').textContent = 'Open this screen by casting from Anime Ongaku.';
}
