import type { PlaylistDto, PlaylistItemDto, PlaylistPlaybackMode } from '../../lib/library'

export interface PlaylistEntryModel {
  /** React/UI identity. It is never sent to the server. */
  key: string
  entryId: number | null
  itemType: PlaylistItemDto['itemType']
  itemId: number
  modeOverride: PlaylistPlaybackMode | null
}

export interface PlaylistEditorValues {
  name: string
  defaultMode: PlaylistPlaybackMode
  overrideUserPreference: boolean
  autoUpdate: boolean
  dynamicSpecJson: string
  dynamicSortJson: string
  isDynamic?: boolean
}

export interface PlaylistFormErrors {
  name?: string
  dynamicSpecJson?: string
  dynamicSortJson?: string
}

export interface PlaylistItemInput {
  entryId?: number
  itemType: PlaylistItemDto['itemType']
  itemId: number
  modeOverride: PlaylistPlaybackMode | null
}

export interface PlaylistUpdateInput {
  name: string
  defaultMode: PlaylistPlaybackMode
  overrideUserPreference: boolean
  autoUpdate: boolean
  items?: PlaylistItemInput[]
  dynamicSpecJson?: unknown | null
  dynamicSortJson?: unknown | null
}

const MAX_JSON_EDITOR_BYTES = 16_384
const NAME_MARKUP = /<[^>]*>/

/** Converts both current item DTOs and legacy `entries` into occurrence-safe view models. */
export function normalizePlaylistItems(playlist: PlaylistDto): PlaylistEntryModel[] {
  if (playlist.items.length > 0) {
    const seen = new Map<number, number>()
    return playlist.items.map((item) => {
      const occurrence = (seen.get(item.entryId) ?? 0) + 1
      seen.set(item.entryId, occurrence)
      return {
        key: item.entryId > 0 ? `entry:${item.entryId}${occurrence > 1 ? `:${occurrence}` : ''}` : `local:${item.itemType}:${item.itemId}:${occurrence}`,
        entryId: item.entryId > 0 ? item.entryId : null,
        itemType: item.itemType,
        itemId: item.itemId,
        modeOverride: item.modeOverride,
      }
    })
  }

  return playlist.entries.map((itemId, index) => ({
    key: `legacy:${index}:${itemId}`,
    entryId: null,
    itemType: 'THEME',
    itemId,
    modeOverride: null,
  }))
}

export function reorderPlaylistItems(items: readonly PlaylistEntryModel[], key: string, delta: -1 | 1): PlaylistEntryModel[] {
  const index = items.findIndex((item) => item.key === key)
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return [...items]
  const next = [...items]
  const [item] = next.splice(index, 1)
  if (item === undefined) return [...items]
  next.splice(nextIndex, 0, item)
  return next
}

export function removePlaylistItem(items: readonly PlaylistEntryModel[], key: string): PlaylistEntryModel[] {
  return items.filter((item) => item.key !== key)
}

export function sanitizePlaylistName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function validatePlaylistForm(values: PlaylistEditorValues): PlaylistFormErrors {
  const errors: PlaylistFormErrors = {}
  const name = sanitizePlaylistName(values.name)
  if (name.length === 0) errors.name = 'Give your playlist a name.'
  else if (name.length > 100) errors.name = 'Playlist names must be 100 characters or fewer.'
  else if (NAME_MARKUP.test(name)) errors.name = 'Playlist name contains unsupported markup.'

  if (values.dynamicSpecJson.trim().length > 0) {
    try {
      parseJsonEditorValue(values.dynamicSpecJson, 'Filter')
    } catch (error) {
      errors.dynamicSpecJson = error instanceof Error ? error.message : 'Filter must be valid JSON.'
    }
  }
  if (values.dynamicSortJson.trim().length > 0) {
    try {
      parseJsonEditorValue(values.dynamicSortJson, 'Sort')
    } catch (error) {
      errors.dynamicSortJson = error instanceof Error ? error.message : 'Sort must be valid JSON.'
    }
  }
  return errors
}

export function parseJsonEditorValue(value: string, label: string): unknown {
  const trimmed = value.trim()
  if (new TextEncoder().encode(trimmed).byteLength > MAX_JSON_EDITOR_BYTES) throw new Error(`${label} is too large.`)
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`${label} must be valid JSON.`)
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error(`${label} must be a JSON object or array.`)
  return parsed
}

export function formatJsonEditorValue(value: unknown | null): string {
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export function buildPlaylistUpdate(values: PlaylistEditorValues, items: readonly PlaylistEntryModel[]): PlaylistUpdateInput {
  const update: PlaylistUpdateInput = {
    name: sanitizePlaylistName(values.name),
    defaultMode: values.defaultMode,
    overrideUserPreference: values.overrideUserPreference,
    autoUpdate: values.autoUpdate,
  }

  const isDynamic = values.isDynamic === true || values.dynamicSpecJson.trim().length > 0
  if (isDynamic) {
    update.dynamicSpecJson = values.dynamicSpecJson.trim().length > 0
      ? parseJsonEditorValue(values.dynamicSpecJson, 'Filter')
      : null
    update.dynamicSortJson = values.dynamicSortJson.trim().length > 0
      ? parseJsonEditorValue(values.dynamicSortJson, 'Sort')
      : null
    // The server is authoritative for auto-update dynamic entries. Sending
    // items here would make a stale browser appear to win the race.
    if (!values.autoUpdate) update.items = toPlaylistItemInputs(items)
  } else {
    update.items = toPlaylistItemInputs(items)
    if (values.isDynamic === false) {
      update.dynamicSpecJson = null
      update.dynamicSortJson = null
    }
  }
  return update
}

export function toPlaylistItemInputs(items: readonly PlaylistEntryModel[]): PlaylistItemInput[] {
  return items.map((item) => ({
    ...(item.entryId !== null && item.entryId > 0 ? { entryId: item.entryId } : {}),
    itemType: item.itemType,
    itemId: item.itemId,
    modeOverride: item.itemType === 'SONG' ? null : item.modeOverride,
  }))
}
