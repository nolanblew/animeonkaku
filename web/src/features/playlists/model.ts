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
  /** Structured editor state. Optional so existing manual callers remain source-compatible. */
  dynamicMode?: DynamicPlaylistMode
  createdMode?: DynamicCreatedMode
  simpleFilter?: SimpleFilterState
  advancedFilter?: FilterNodeJson
  sortSpec?: SortSpecJson
  /** When true, the recovery textareas are the source of truth on submit. */
  useExpertJson?: boolean
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

export type DynamicPlaylistMode = 'AUTO' | 'SNAPSHOT'
export type DynamicCreatedMode = 'SIMPLE' | 'ADVANCED'

/** JSON-compatible shape emitted by the Android Moshi FilterNode adapter. */
export interface FilterNodeJson {
  type: string
  [key: string]: unknown
}

export type FilterDateAnchorJson =
  | { type: 'absolute_year'; year: number }
  | { type: 'relative'; unit: 'DAYS' | 'MONTHS' | 'YEARS'; amount: number }

export interface SimpleFilterState {
  timeMode: 'ANY' | 'LAST_6_MONTHS' | 'LAST_2_YEARS' | 'BEFORE_2000' | 'Y2000_2010' | 'Y2010_2020' | 'CUSTOM'
  customRange: { type: 'relative'; durationMillis: number } | { type: 'exact'; startYear: number; endYear: number } | null
  timeDimension: 'AIRED' | 'WATCHED'
  seasons: string[]
  genreSlugs: string[]
  genreMatchAll: boolean
  minRating: number | null
  ratingSource: 'MINE' | 'AVERAGE'
  subtypes: string[]
  watchingStatuses: string[]
  themeTypes: string[]
}

export interface SortKeyJson {
  attribute: string
  direction: 'ASC' | 'DESC'
  categoricalOrder?: string[]
}

export interface SortSpecJson {
  keys: SortKeyJson[]
}

export interface DynamicSpecEnvelope {
  filterJson: FilterNodeJson
  mode: DynamicPlaylistMode
  createdMode: DynamicCreatedMode
  schemaVersion: 1
  sortJson?: SortSpecJson
  simpleStateJson?: SimpleFilterState
}

export const DEFAULT_ADVANCED_FILTER: FilterNodeJson = { type: 'and', children: [] }

export const DEFAULT_SORT_SPEC: SortSpecJson = {
  keys: [
    { attribute: 'WATCHED_DATE', direction: 'DESC' },
    { attribute: 'TITLE', direction: 'ASC' },
  ],
}

export function createDefaultSimpleFilter(): SimpleFilterState {
  return {
    timeMode: 'ANY',
    customRange: null,
    timeDimension: 'AIRED',
    seasons: [],
    genreSlugs: [],
    genreMatchAll: false,
    minRating: null,
    ratingSource: 'MINE',
    subtypes: [],
    watchingStatuses: [],
    themeTypes: [],
  }
}

const SORT_ATTRIBUTES = new Set([
  'TITLE', 'ARTIST', 'ANIME_TITLE', 'THEME_TYPE', 'THEME_ORDER_GROUPED',
  'THEME_ORDER_INTERLEAVED', 'AIRED_DATE', 'WATCHED_DATE', 'AVERAGE_RATING',
  'MY_RATING', 'PLAY_COUNT', 'LAST_PLAYED', 'LIKED', 'DOWNLOADED', 'RANDOM',
  'WATCHING_STATUS', 'SUBTYPE', 'SEASON',
])
const DATE_UNITS = new Set(['DAYS', 'MONTHS', 'YEARS'])

/** Compile the same simple sections used by Android into the server filter tree. */
export function compileSimpleFilter(state: SimpleFilterState): FilterNodeJson {
  const children: FilterNodeJson[] = []
  const add = (node: FilterNodeJson) => children.push(node)

  switch (state.timeMode) {
    case 'LAST_6_MONTHS':
      add(state.timeDimension === 'WATCHED'
        ? { type: 'watched_on', operator: 'GT', anchor: { type: 'relative', unit: 'DAYS', amount: 182 } }
        : { type: 'aired_on', operator: 'GT', anchor: { type: 'relative', unit: 'DAYS', amount: 182 } })
      break
    case 'LAST_2_YEARS':
      add(state.timeDimension === 'WATCHED'
        ? { type: 'watched_on', operator: 'GT', anchor: { type: 'relative', unit: 'YEARS', amount: 2 } }
        : { type: 'aired_on', operator: 'GT', anchor: { type: 'relative', unit: 'YEARS', amount: 2 } })
      break
    case 'BEFORE_2000':
      if (state.timeDimension === 'WATCHED') add(watchedYearFilter(undefined, 1999))
      else add(airedRangeFilter('LT', 2000))
      break
    case 'Y2000_2010':
      if (state.timeDimension === 'WATCHED') add(watchedYearFilter(2000, 2010))
      else add(airedRangeFilter('BETWEEN', 2000, 2010))
      break
    case 'Y2010_2020':
      if (state.timeDimension === 'WATCHED') add(watchedYearFilter(2010, 2020))
      else add(airedRangeFilter('BETWEEN', 2010, 2020))
      break
    case 'CUSTOM': {
      const range = state.customRange
      if (range?.type === 'relative' && state.timeDimension === 'WATCHED') {
        add({ type: 'watched_on', operator: 'GT', anchor: { type: 'relative', unit: 'DAYS', amount: Math.max(0, Math.floor(range.durationMillis / 86_400_000)) } })
      } else if (range?.type === 'exact') {
        if (state.timeDimension === 'AIRED') add(airedRangeFilter('BETWEEN', range.startYear, range.endYear))
        else add(watchedYearFilter(range.startYear, range.endYear))
      }
      break
    }
    case 'ANY':
      break
  }

  if (state.seasons.length > 0) add({ type: 'season_in', seasons: [...state.seasons] })
  if (state.genreSlugs.length > 0) add({ type: 'genre_in', slugs: [...state.genreSlugs], matchAll: state.genreMatchAll })
  if (state.minRating !== null) add({ type: state.ratingSource === 'AVERAGE' ? 'average_rating_gte' : 'user_rating_gte', min: state.minRating })
  if (state.subtypes.length > 0) add({ type: 'subtype_in', subtypes: [...state.subtypes] })
  if (state.watchingStatuses.length > 0) add({ type: 'watching_status_in', statuses: [...state.watchingStatuses] })
  if (state.themeTypes.length > 0) add({ type: 'theme_type_in', types: [...state.themeTypes] })
  return { type: 'and', children }
}

function airedRangeFilter(operator: 'LT' | 'BETWEEN', startYear: number, endYear?: number): FilterNodeJson {
  return {
    type: 'aired_on',
    operator,
    anchor: { type: 'absolute_year', year: startYear },
    ...(operator === 'BETWEEN' ? { endAnchor: { type: 'absolute_year', year: endYear ?? startYear } } : {}),
  }
}

function watchedYearFilter(startYear?: number, endYear?: number): FilterNodeJson {
  const children: FilterNodeJson[] = [{ type: 'watched_on', operator: 'GT', anchor: { type: 'absolute_year', year: startYear ?? 0 } }]
  if (endYear !== undefined) children.push({ type: 'not', child: { type: 'watched_on', operator: 'GT', anchor: { type: 'absolute_year', year: endYear + 1 } } })
  return children.length === 1 ? children[0]! : { type: 'and', children }
}

/** Make an advanced root from the two mobile-style sections. */
export function buildAdvancedFilter(include: readonly FilterNodeJson[], exclude: readonly FilterNodeJson[]): FilterNodeJson {
  const children = [
    ...include.map(cloneFilterNode),
    ...exclude.map((node) => ({ type: 'not', child: cloneFilterNode(node) })),
  ]
  return children.length === 0 ? cloneFilterNode(DEFAULT_ADVANCED_FILTER) : { type: 'and', children }
}

export function serializeSortSpec(sort: SortSpecJson): SortSpecJson {
  return {
    keys: sort.keys.slice(0, 5).map((key) => ({
      attribute: key.attribute,
      direction: key.direction,
      ...(key.categoricalOrder && key.categoricalOrder.length > 0 ? { categoricalOrder: [...key.categoricalOrder] } : {}),
    })),
  }
}

export function deserializeSortSpec(value: unknown): SortSpecJson {
  const parsed = typeof value === 'string' ? parseUnknownJson(value) : value
  if (!isRecord(parsed) || !Array.isArray(parsed.keys)) return cloneSortSpec(DEFAULT_SORT_SPEC)
  return {
    keys: parsed.keys.filter(isRecord).slice(0, 5).map((key) => ({
      attribute: typeof key.attribute === 'string' ? key.attribute : 'TITLE',
      direction: key.direction === 'DESC' ? 'DESC' : 'ASC',
      ...(Array.isArray(key.categoricalOrder) && key.categoricalOrder.length > 0 ? { categoricalOrder: key.categoricalOrder.filter((v): v is string => typeof v === 'string') } : {}),
    })),
  }
}

export function serializeDynamicSpec(input: {
  filter: FilterNodeJson
  mode: DynamicPlaylistMode
  createdMode: DynamicCreatedMode
  sort?: SortSpecJson
  simpleFilter?: SimpleFilterState
}): DynamicSpecEnvelope {
  return {
    filterJson: cloneFilterNode(input.filter),
    mode: input.mode,
    createdMode: input.createdMode,
    schemaVersion: 1,
    ...(input.sort ? { sortJson: serializeSortSpec(input.sort) } : {}),
    ...(input.simpleFilter ? { simpleStateJson: cloneSimpleFilter(input.simpleFilter) } : {}),
  }
}

export interface DeserializedDynamicSpec {
  filter: FilterNodeJson
  mode: DynamicPlaylistMode
  createdMode: DynamicCreatedMode
  sort: SortSpecJson
  simpleFilter: SimpleFilterState | null
}

/** Accept both current envelopes and direct/legacy filter nodes from the server. */
export function deserializeDynamicSpec(value: unknown): DeserializedDynamicSpec {
  const parsed = typeof value === 'string' ? parseUnknownJson(value) : value
  if (!isRecord(parsed)) return { filter: cloneFilterNode(DEFAULT_ADVANCED_FILTER), mode: 'AUTO', createdMode: 'ADVANCED', sort: cloneSortSpec(DEFAULT_SORT_SPEC), simpleFilter: null }
  const filterCandidate = parsed.filterJson ?? parsed
  const filter = isRecord(filterCandidate) && typeof filterCandidate.type === 'string'
    ? cloneFilterNode(filterCandidate as FilterNodeJson)
    : cloneFilterNode(DEFAULT_ADVANCED_FILTER)
  const mode: DynamicPlaylistMode = parsed.mode === 'SNAPSHOT' ? 'SNAPSHOT' : 'AUTO'
  const createdMode: DynamicCreatedMode = parsed.createdMode === 'SIMPLE' ? 'SIMPLE' : 'ADVANCED'
  const simpleCandidate = parsed.simpleStateJson
  return {
    filter,
    mode,
    createdMode,
    sort: deserializeSortSpec(parsed.sortJson ?? DEFAULT_SORT_SPEC),
    simpleFilter: isRecord(simpleCandidate) ? deserializeSimpleFilter(simpleCandidate) : null,
  }
}

export function validateFilterNode(node: FilterNodeJson, isRoot = true, allowEmptyRoot = false): string[] {
  if (node.type === 'and' || node.type === 'or') {
    const children = Array.isArray(node.children) ? node.children.filter(isRecord) as FilterNodeJson[] : []
    if (children.length === 0) {
      if (isRoot && allowEmptyRoot) return []
      return [isRoot ? 'Add at least one rule before saving.' : 'Remove or fill empty groups before saving.']
    }
    return children.flatMap((child) => validateFilterNode(child, false, false))
  }
  if (node.type === 'not') {
    return isRecord(node.child) ? validateFilterNode(node.child as FilterNodeJson, false, false) : ['A NOT rule needs a child rule.']
  }
  if (node.type === 'title_matches' && !nonEmptyString(node.pattern)) return ['Title pattern cannot be empty.']
  if (node.type === 'song_title_matches' && !nonEmptyString(node.pattern)) return ['Song title pattern cannot be empty.']
  if (node.type === 'artist_in' && !nonEmptyStringArray(node.artistNames)) return ['Add at least one artist.']
  if (node.type === 'genre_in' && !nonEmptyStringArray(node.slugs)) return ['Add at least one genre.']
  if (node.type === 'season_in' && !nonEmptyStringArray(node.seasons)) return ['Select at least one season.']
  if (node.type === 'subtype_in' && !nonEmptyStringArray(node.subtypes)) return ['Select at least one media type.']
  if (node.type === 'watching_status_in' && !nonEmptyStringArray(node.statuses)) return ['Select at least one watching status.']
  if (node.type === 'theme_type_in' && !nonEmptyStringArray(node.types)) return ['Select at least one theme type.']
  if (node.type === 'average_rating_gte' || node.type === 'user_rating_gte') {
    const minimum = numberValue(node.min)
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 10) return ['Rating must be between 0 and 10.']
  }
  if (node.type === 'play_count_gte' && (numberValue(node.min) < 0 || !Number.isFinite(numberValue(node.min)))) return ['Play count cannot be negative.']
  if (node.type === 'aired_on' || node.type === 'watched_on' || node.type === 'played_on') {
    if (!validDateAnchor(node.anchor)) return ['Choose a valid date value.']
    if (node.operator === 'BETWEEN' && !validDateAnchor(node.endAnchor)) return ['Choose a valid end date value.']
  }
  return []
}

export function validateSortSpec(sort: SortSpecJson): string[] {
  const errors: string[] = []
  if (sort.keys.length > 5) errors.push('Sort can contain at most 5 keys.')
  sort.keys.forEach((key, index) => {
    if (!SORT_ATTRIBUTES.has(key.attribute)) errors.push(`Sort key ${index + 1} has an unsupported attribute.`)
    if (key.direction !== 'ASC' && key.direction !== 'DESC') errors.push(`Sort key ${index + 1} has an unsupported direction.`)
  })
  return errors
}

function validDateAnchor(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'absolute_year') return Number.isInteger(value.year) && Number(value.year) >= 1900 && Number(value.year) <= 2200
  return value.type === 'relative' && DATE_UNITS.has(String(value.unit)) && Number.isInteger(value.amount) && Number(value.amount) >= 0
}

function deserializeSimpleFilter(value: Record<string, unknown>): SimpleFilterState {
  const defaults = createDefaultSimpleFilter()
  return {
    timeMode: isOneOf(value.timeMode, ['ANY', 'LAST_6_MONTHS', 'LAST_2_YEARS', 'BEFORE_2000', 'Y2000_2010', 'Y2010_2020', 'CUSTOM']) ? value.timeMode as SimpleFilterState['timeMode'] : defaults.timeMode,
    customRange: isRecord(value.customRange) && (value.customRange.type === 'relative' || value.customRange.type === 'exact') ? value.customRange as SimpleFilterState['customRange'] : null,
    timeDimension: value.timeDimension === 'WATCHED' ? 'WATCHED' : 'AIRED',
    seasons: stringArray(value.seasons),
    genreSlugs: stringArray(value.genreSlugs),
    genreMatchAll: value.genreMatchAll === true,
    minRating: typeof value.minRating === 'number' ? value.minRating : null,
    ratingSource: value.ratingSource === 'AVERAGE' ? 'AVERAGE' : 'MINE',
    subtypes: stringArray(value.subtypes),
    watchingStatuses: stringArray(value.watchingStatuses),
    themeTypes: stringArray(value.themeTypes),
  }
}

function cloneFilterNode(node: FilterNodeJson): FilterNodeJson {
  return JSON.parse(JSON.stringify(node)) as FilterNodeJson
}

function cloneSimpleFilter(state: SimpleFilterState): SimpleFilterState {
  return JSON.parse(JSON.stringify(state)) as SimpleFilterState
}

function cloneSortSpec(sort: SortSpecJson): SortSpecJson {
  return serializeSortSpec(sort)
}

function parseUnknownJson(value: string): unknown {
  try { return JSON.parse(value) } catch { return null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function nonEmptyString(value: unknown): boolean { return typeof value === 'string' && value.trim().length > 0 }
function nonEmptyStringArray(value: unknown): boolean { return stringArray(value).some((entry) => entry.trim().length > 0) }
function numberValue(value: unknown): number { return typeof value === 'number' ? value : Number(value) }
function isOneOf(value: unknown, options: readonly string[]): boolean { return typeof value === 'string' && options.includes(value) }

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
  if (values.isDynamic === true && values.useExpertJson !== true) {
    const mode = values.createdMode ?? (values.simpleFilter ? 'SIMPLE' : values.advancedFilter ? 'ADVANCED' : null)
    if (mode === 'SIMPLE' && values.simpleFilter) {
      // Compilation is intentionally exercised here so an invalid structured
      // value is shown beside the editor before the request is made.
      // Android treats an all-"Any" simple filter as a valid match-all smart
      // playlist, while advanced mode still requires an explicit rule.
      const filterErrors = validateFilterNode(compileSimpleFilter(values.simpleFilter), true, true)
      if (filterErrors.length > 0) errors.dynamicSpecJson = filterErrors[0]
    }
    if (mode === 'ADVANCED' && values.advancedFilter) {
      const filterErrors = validateFilterNode(values.advancedFilter)
      if (filterErrors.length > 0) errors.dynamicSpecJson = filterErrors[0]
    }
    if (values.sortSpec) {
      const sortErrors = validateSortSpec(values.sortSpec)
      if (sortErrors.length > 0) errors.dynamicSortJson = sortErrors[0]
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
    const hasStructuredState = values.useExpertJson !== true && (
      (values.createdMode === 'SIMPLE' && values.simpleFilter !== undefined) ||
      (values.createdMode === 'ADVANCED' && values.advancedFilter !== undefined)
    )
    if (hasStructuredState) {
      const createdMode = values.createdMode ?? 'ADVANCED'
      const mode = values.dynamicMode ?? (values.autoUpdate ? 'AUTO' : 'SNAPSHOT')
      update.autoUpdate = mode === 'AUTO'
      const filter = createdMode === 'SIMPLE'
        ? compileSimpleFilter(values.simpleFilter ?? createDefaultSimpleFilter())
        : values.advancedFilter ?? cloneFilterNode(DEFAULT_ADVANCED_FILTER)
      const sort = values.sortSpec ? serializeSortSpec(values.sortSpec) : deserializeSortSpec(values.dynamicSortJson || DEFAULT_SORT_SPEC)
      update.dynamicSpecJson = serializeDynamicSpec({
        filter,
        mode,
        createdMode,
        sort,
        simpleFilter: createdMode === 'SIMPLE' ? values.simpleFilter : undefined,
      })
      update.dynamicSortJson = sort
    } else {
      update.dynamicSpecJson = values.dynamicSpecJson.trim().length > 0
        ? parseJsonEditorValue(values.dynamicSpecJson, 'Filter')
        : null
      update.dynamicSortJson = values.dynamicSortJson.trim().length > 0
        ? parseJsonEditorValue(values.dynamicSortJson, 'Sort')
        : null
    }
    // The server is authoritative for auto-update dynamic entries. Sending
    // items here would make a stale browser appear to win the race.
    const effectiveMode = values.dynamicMode ?? (values.autoUpdate ? 'AUTO' : 'SNAPSHOT')
    update.autoUpdate = effectiveMode === 'AUTO'
    if (effectiveMode === 'SNAPSHOT') update.items = toPlaylistItemInputs(items)
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
