import type { LibraryThemeDto, LoudnessDto, MusicTrackDto } from '../lib/library'
import type { PlaybackMode } from '../media/modeSwitch'
import type { QueueItem } from './queue'

export interface PlayerQueueItem extends QueueItem {
  readonly itemType: 'THEME' | 'SONG'
  readonly mode?: PlaybackMode
  readonly tvAudioUrl?: string
  readonly fullAudioUrl?: string
  readonly tvDurationMs?: number
  readonly fullDurationMs?: number
  readonly tvLoudness?: LoudnessDto
  readonly fullLoudness?: LoudnessDto
  readonly videoMimeType?: string | null
  readonly videoSpoiler?: boolean
  readonly videoNsfw?: boolean
  readonly themeId?: number
  readonly songId?: number
}

export interface ThemeQueueItemOptions {
  artworkUrl?: string | null
  animeId?: string | number | null
  mode?: PlaybackMode
}

/** Converts an API theme into the occurrence payload used by QueueStore. */
export function mapThemeToQueueItem(theme: LibraryThemeDto, options: ThemeQueueItemOptions = {}): PlayerQueueItem {
  const tv = theme.mediaModes?.tvSize
  const full = theme.mediaModes?.fullSize
  const video = theme.mediaModes?.video
  const tvAudioUrl = tv?.url || theme.audioUrl || undefined
  const fullAudioUrl = full?.url || undefined
  const videoUrl = video?.url || theme.videoUrl || undefined
  const selectedMode = options.mode ?? 'TV_SIZE'
  const audioUrl = selectedMode === 'FULL_SIZE' && fullAudioUrl ? fullAudioUrl : tvAudioUrl
  const artists = theme.artists?.map((artist) => artist.name.trim()).filter(Boolean).join(', ')

  return {
    id: theme.id,
    title: theme.title || 'Untitled theme',
    artist: artists || undefined,
    album: theme.themeType || undefined,
    animeId: options.animeId ?? theme.kitsuAnimeIds?.[0],
    artworkUrl: options.artworkUrl ?? undefined,
    audioUrl,
    videoUrl,
    itemType: 'THEME',
    // An absent mode inherits the provider's remembered user default. Playlist
    // projections pass an explicit mode when their policy requires one.
    mode: options.mode,
    tvAudioUrl,
    fullAudioUrl,
    tvDurationMs: secondsToMilliseconds(tv?.durationSeconds ?? theme.durationSeconds),
    fullDurationMs: secondsToMilliseconds(full?.durationSeconds),
    tvLoudness: tv?.loudness,
    fullLoudness: full?.loudness,
    videoMimeType: video?.mimeType ?? null,
    videoSpoiler: Boolean(video?.spoiler),
    videoNsfw: Boolean(video?.nsfw),
    themeId: theme.id,
  }
}

/** Converts a catalog full-song track into a QueueStore item. */
export function mapSongToQueueItem(song: MusicTrackDto, options: Omit<ThemeQueueItemOptions, 'mode'> = {}): PlayerQueueItem {
  return {
    id: song.id,
    title: song.title || 'Untitled song',
    artist: song.artistCredit || song.artistNames?.map((artist) => artist.english || artist.romaji || artist.japanese).filter(Boolean).join(', ') || undefined,
    album: undefined,
    animeId: options.animeId ?? undefined,
    artworkUrl: options.artworkUrl ?? undefined,
    audioUrl: song.audioUrl || undefined,
    itemType: 'SONG',
    mode: 'FULL_SIZE',
    tvAudioUrl: undefined,
    fullAudioUrl: song.audioUrl || undefined,
    fullDurationMs: secondsToMilliseconds(song.durationSeconds),
    fullLoudness: song.loudness,
    songId: song.id,
  }
}

export function queueItemAudioUrl(item: QueueItem, mode: PlaybackMode): string | undefined {
  const candidate = item as PlayerQueueItem
  if (mode === 'FULL_SIZE') {
    if (candidate.fullAudioUrl) return candidate.fullAudioUrl
    // API themes distinguish TV-size and full-size availability. A generic
    // QueueItem without the richer marker remains usable in either mode.
    if (candidate.itemType === 'THEME') return undefined
    return candidate.audioUrl || candidate.tvAudioUrl
  }
  if (candidate.itemType === 'SONG') return undefined
  return candidate.tvAudioUrl || candidate.audioUrl || candidate.fullAudioUrl
}

export function queueItemVideoUrl(item: QueueItem): string | undefined {
  return (item as PlayerQueueItem).videoUrl || undefined
}

export function queueItemDurationMs(item: QueueItem, mode: PlaybackMode): number | undefined {
  const candidate = item as PlayerQueueItem
  const duration = mode === 'FULL_SIZE' ? candidate.fullDurationMs : candidate.tvDurationMs
  return Number.isFinite(duration) && (duration ?? 0) > 0 ? duration : item.durationMs
}

/** Converts a ready loudness profile into a safe HTMLMediaElement attenuation. */
export function queueItemLoudnessVolume(item: QueueItem, mode: PlaybackMode): number {
  if (mode === 'VIDEO') return 1
  const candidate = item as PlayerQueueItem
  const loudness = mode === 'FULL_SIZE' ? candidate.fullLoudness : candidate.tvLoudness
  if (!loudness || loudness.state !== 'READY' || !Number.isFinite(loudness.gainDb)) return 1
  const gainDb = Math.max(-60, Math.min(0, loudness.gainDb))
  const volume = 10 ** (gainDb / 20)
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1
}

function secondsToMilliseconds(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : undefined
}
