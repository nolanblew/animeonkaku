import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, ListPlus, MoreHorizontal, Music2, Play, Shuffle, Sparkles } from 'lucide-react'
import type { NormalizedLibrary, PlaylistDto, PlaylistPlaybackMode } from '../../lib/library'
import { DynamicPlaylistBuilder } from './dynamicBuilder'
import { buildPlaylistUpdate, createDefaultSimpleFilter, DEFAULT_ADVANCED_FILTER, DEFAULT_SORT_SPEC, deserializeDynamicSpec, deserializeSortSpec, formatJsonEditorValue, normalizePlaylistItems, parseJsonEditorValue, removePlaylistItem, reorderPlaylistItems, sanitizePlaylistName, toPlaylistItemInputs, validatePlaylistForm, type DynamicCreatedMode, type DynamicPlaylistMode, type FilterNodeJson, type PlaylistEditorValues, type PlaylistEntryModel, type PlaylistFormErrors, type PlaylistUpdateInput, type SimpleFilterState, type SortSpecJson } from './model'
import type { PlaylistCreateInput } from './api'
import { useLibraryQuery } from '../../lib/query'
import { PlaylistArtwork, playlistArtworkUrls } from './PlaylistArtwork'
import { buildPlaylistSongIndex, resolvePlaylistDisplayItems } from './playlistDisplay'
import { CollectionActionMenu, TrackActionMenu } from '../libraryactions'
import { useAccessibleFocusScope, useRovingMenu } from '../../components/focusScope'
import { ViewportMenu } from '../../components/ViewportMenu'
import { useAnimeTitlePreference } from '../../lib/animeTitlePreference'
import './playlists.css'

export type PlaylistListState = 'loading' | 'ready' | 'empty' | 'error'

export interface PlaylistListProps {
  playlists: PlaylistDto[]
  state: PlaylistListState
  error?: string
  onCreate: () => void
  onSelect?: (id: number) => void
  onPlay?: (playlist: PlaylistDto) => void
  onEdit?: (playlist: PlaylistDto) => void
  onRequestDelete?: (playlist: PlaylistDto) => void
  maxVisible?: number
}

const MAX_PLAYLIST_PAGE_SIZE = 100
const PLAYLIST_TRACK_PAGE_SIZE = 48

export function PlaylistList({ playlists, state, error, onCreate, onSelect, onPlay, onEdit, onRequestDelete, maxVisible = 100 }: PlaylistListProps) {
  const library = useLibraryQuery({ enabled: false }).library
  const [filter, setFilter] = useState('')
  const pageSize = normalizePlaylistPageSize(maxVisible)
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const filtered = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return playlists
      .filter((playlist) => !playlist.deleted && (query.length === 0 || playlist.name.toLocaleLowerCase().includes(query)))
  }, [filter, playlists])
  const visible = filtered.slice(0, visibleCount)

  useEffect(() => setVisibleCount(pageSize), [pageSize])
  const changeFilter = (value: string) => {
    setFilter(value)
    setVisibleCount(pageSize)
  }

  return (
    <section className="playlist-list" aria-labelledby="playlist-list-title">
      <header className="playlist-list__header">
        <div>
          <p className="playlist-eyebrow">Your library</p>
          <h2 id="playlist-list-title">Playlists</h2>
        </div>
        <button type="button" className="playlist-button playlist-button--primary" onClick={onCreate}>+ New playlist</button>
      </header>
      <label className="playlist-field playlist-list__filter">
        <span>Filter playlists</span>
        <input aria-label="Filter playlists" type="search" value={filter} onChange={(event) => changeFilter(event.target.value)} placeholder="Search your playlists" />
      </label>
      {state === 'loading' && <p className="playlist-state" role="status">Loading playlists…</p>}
      {state === 'error' && <p className="playlist-state playlist-state--error" role="alert">{error ?? 'Could not load playlists.'}</p>}
      {state !== 'loading' && state !== 'error' && visible.length === 0 && <div className="playlist-empty"><strong>No playlists yet</strong><span>Create a playlist to keep your favorite themes together.</span><button type="button" className="playlist-button" onClick={onCreate}>Create playlist</button></div>}
      {state !== 'loading' && state !== 'error' && visible.length > 0 && (
        <>
          <div className="playlist-cards">
            {visible.map((playlist) => <PlaylistListCard key={playlist.id} playlist={playlist} library={library} onSelect={onSelect} onPlay={onPlay} onEdit={onEdit} onRequestDelete={onRequestDelete} />)}
          </div>
          {filtered.length > visible.length && <div className="playlist-list__pagination"><p className="playlist-list__count">Showing {visible.length} of {filtered.length} playlists.</p><button type="button" className="playlist-button" onClick={() => setVisibleCount((current) => Math.min(current + pageSize, filtered.length))}>Load more playlists</button></div>}
        </>
      )}
    </section>
  )
}

function PlaylistListCard({ playlist, library, onSelect, onPlay, onEdit, onRequestDelete }: {
  playlist: PlaylistDto
  library: NormalizedLibrary | null | undefined
  onSelect?: (id: number) => void
  onPlay?: (playlist: PlaylistDto) => void
  onEdit?: (playlist: PlaylistDto) => void
  onRequestDelete?: (playlist: PlaylistDto) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRovingMenu<HTMLDivElement>({ open, onClose: () => setOpen(false), triggerRef })
  const playlistPath = `/playlist/${playlist.id}`

  useEffect(() => {
    if (!open) return undefined
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const run = (action?: (playlist: PlaylistDto) => void) => {
    setOpen(false)
    action?.(playlist)
  }

  return <article className={`playlist-card${open ? ' playlist-card--menu-open' : ''}`} ref={rootRef}>
    <Link className="playlist-card__link" to={playlistPath} onClick={() => onSelect?.(playlist.id)}>
      <PlaylistArtwork playlistId={playlist.id} name={playlist.name} artworkUrls={playlistArtworkUrls(playlist, library)} />
      <span className="playlist-card__copy"><strong>{playlist.name}</strong><small>{playlist.isDynamic ? 'Smart playlist' : `${playlist.items.length || playlist.entries.length} tracks`}</small></span>
      <span className="playlist-card__arrow" aria-hidden="true">→</span>
    </Link>
    {(onPlay || onEdit || onRequestDelete) && <>
      <button ref={triggerRef} type="button" className="playlist-card__actions-trigger" aria-label={`More actions for ${playlist.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={20} /></button>
      <ViewportMenu open={open} triggerRef={triggerRef} menuRef={menuRef} className="playlist-card__actions-menu" label={`${playlist.name} actions`}>
        <Link role="menuitem" to={playlistPath} onClick={() => setOpen(false)}>Open playlist</Link>
        {onPlay && <button type="button" role="menuitem" onClick={() => run(onPlay)}>Play playlist</button>}
        {onEdit && <button type="button" role="menuitem" onClick={() => run(onEdit)}>Edit playlist</button>}
        {onRequestDelete && <button type="button" role="menuitem" className="playlist-card__actions-danger" onClick={() => run(onRequestDelete)}>Delete playlist</button>}
      </ViewportMenu>
    </>}
  </article>
}

function normalizePlaylistPageSize(value: number): number {
  if (!Number.isFinite(value)) return MAX_PLAYLIST_PAGE_SIZE
  return Math.min(MAX_PLAYLIST_PAGE_SIZE, Math.max(1, Math.floor(value)))
}

export interface PlaylistEditorProps {
  playlist?: PlaylistDto
  onSubmit: (input: PlaylistCreateInput | (Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] })) => Promise<unknown> | unknown
  onCancel?: () => void
  initialFocusRef?: RefObject<HTMLButtonElement | null>
}

const emptyEditorValues: PlaylistEditorValues = {
  name: '',
  defaultMode: 'TV_SIZE',
  overrideUserPreference: false,
  autoUpdate: true,
  dynamicSpecJson: '',
  dynamicSortJson: '',
  isDynamic: false,
}

export function PlaylistEditor({ playlist, onSubmit, onCancel, initialFocusRef }: PlaylistEditorProps) {
  const [values, setValues] = useState<PlaylistEditorValues>(() => playlist ? editorValuesFor(playlist) : emptyEditorValues)
  const [items, setItems] = useState<PlaylistEntryModel[]>(() => playlist ? normalizePlaylistItems(playlist) : [])
  const initialStructured = structuredEditorFor(playlist)
  const [createdMode, setCreatedMode] = useState<DynamicCreatedMode>(initialStructured.createdMode)
  const [dynamicMode, setDynamicMode] = useState<DynamicPlaylistMode>(initialStructured.dynamicMode)
  const [simpleFilter, setSimpleFilter] = useState<SimpleFilterState>(initialStructured.simpleFilter)
  const [advancedFilter, setAdvancedFilter] = useState<FilterNodeJson>(initialStructured.advancedFilter)
  const [sortSpec, setSortSpec] = useState<SortSpecJson>(initialStructured.sortSpec)
  const [errors, setErrors] = useState<PlaylistFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [creationKind, setCreationKind] = useState<'MANUAL' | 'SMART' | null>(() => playlist ? (playlist.isDynamic ? 'SMART' : 'MANUAL') : null)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)

  useEffect(() => {
    setValues(playlist ? editorValuesFor(playlist) : emptyEditorValues)
    setItems(playlist ? normalizePlaylistItems(playlist) : [])
    const next = structuredEditorFor(playlist)
    setCreatedMode(next.createdMode)
    setDynamicMode(next.dynamicMode)
    setSimpleFilter(next.simpleFilter)
    setAdvancedFilter(next.advancedFilter)
    setSortSpec(next.sortSpec)
    setCreationKind(playlist ? (playlist.isDynamic ? 'SMART' : 'MANUAL') : null)
    setWizardStep(1)
  }, [playlist])

  const isCreate = playlist === undefined
  const setValue = <K extends keyof PlaylistEditorValues>(key: K, value: PlaylistEditorValues[K]) => setValues((current) => ({ ...current, [key]: value }))
  const chooseKind = (kind: 'MANUAL' | 'SMART') => {
    setCreationKind(kind)
    setValue('isDynamic', kind === 'SMART')
    if (kind === 'SMART') { setCreatedMode('SIMPLE'); setValue('createdMode', 'SIMPLE') }
  }
  const continueToRules = () => {
    if (sanitizePlaylistName(values.name).length === 0) { setErrors({ name: 'Give this playlist a name.' }); return }
    setErrors({})
    setWizardStep(2)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const submitValues: PlaylistEditorValues = {
      ...values,
      createdMode,
      dynamicMode,
      simpleFilter,
      advancedFilter,
      sortSpec,
      autoUpdate: dynamicMode === 'AUTO',
    }
    const nextErrors = validatePlaylistForm(submitValues)
    setErrors(nextErrors)
    setSubmitError(null)
    if (Object.keys(nextErrors).length > 0) return
    setSaving(true)
    try {
      const update = buildPlaylistUpdate(submitValues, items)
      await onSubmit(isCreate ? { ...update, name: sanitizePlaylistName(submitValues.name) } : update)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not save playlist.')
    } finally {
      setSaving(false)
    }
  }

  if (isCreate && creationKind === null) return (
    <section className="playlist-type-picker" aria-labelledby="playlist-type-title">
      <div className="playlist-editor__heading"><div><p className="playlist-eyebrow">New collection</p><h2 id="playlist-type-title">What kind of playlist?</h2><p>Start simple, or let Anime Ongaku keep a smart mix up to date for you.</p></div>{onCancel && <button type="button" className="playlist-button playlist-button--quiet" onClick={onCancel}>Cancel</button>}</div>
      <div className="playlist-type-picker__choices">
        <button ref={initialFocusRef} type="button" onClick={() => chooseKind('MANUAL')}><span className="playlist-type-picker__icon"><ListPlus aria-hidden="true" /></span><span><strong>Manual playlist</strong><small>You choose and arrange every track. Best for favorites, parties, and hand-picked sets.</small></span><ArrowRight aria-hidden="true" /></button>
        <button type="button" onClick={() => chooseKind('SMART')}><span className="playlist-type-picker__icon playlist-type-picker__icon--smart"><Sparkles aria-hidden="true" /></span><span><strong>Smart playlist</strong><small>Build rules from anime, theme, rating, genre, and listening data. It can update itself.</small></span><ArrowRight aria-hidden="true" /></button>
      </div>
    </section>
  )

  const isSmartCreate = isCreate && creationKind === 'SMART'
  const showDetails = !isSmartCreate || wizardStep === 1
  const showRules = values.isDynamic === true && (!isSmartCreate || wizardStep === 2)
  const showReview = isSmartCreate && wizardStep === 3
  return (
    <form className="playlist-editor" onSubmit={submit} noValidate>
      <div className="playlist-editor__heading"><div><p className="playlist-eyebrow">{isSmartCreate ? 'Smart playlist builder' : isCreate ? 'Manual playlist' : 'Playlist settings'}</p><h2>{showReview ? 'Review & create' : isSmartCreate ? wizardStep === 1 ? 'Name your smart playlist' : 'Choose what belongs' : isCreate ? 'Create playlist' : 'Edit playlist'}</h2></div>{onCancel && <button type="button" className="playlist-button playlist-button--quiet" onClick={onCancel}>Cancel</button>}</div>
      {isSmartCreate && <SmartPlaylistSteps current={wizardStep} onSelect={setWizardStep} />}
      {showDetails && <div className="playlist-editor__step-panel">
        <p className="playlist-muted">Give the collection a recognizable name and choose how tracks should play by default.</p>
        <label className="playlist-field"><span>Name</span><input aria-label="Playlist name" value={values.name} maxLength={100} onChange={(event) => setValue('name', event.target.value)} autoComplete="off" placeholder={creationKind === 'SMART' ? 'Late-night openings' : 'My favorites'} />{errors.name && <small className="playlist-field__error">{errors.name}</small>}</label>
        <div className="playlist-editor__grid">
          <label className="playlist-field"><span>Default playback</span><select value={values.defaultMode} onChange={(event) => setValue('defaultMode', event.target.value as PlaylistPlaybackMode)}><option value="TV_SIZE">TV size</option><option value="FULL_SIZE">Full size</option></select></label>
          <label className="playlist-check"><input type="checkbox" checked={values.overrideUserPreference} onChange={(event) => setValue('overrideUserPreference', event.target.checked)} /><span>Require selected version (skip unavailable or conflicting tracks)</span></label>
        </div>
      </div>}
      {!isCreate && <label className="playlist-check"><input aria-label="Dynamic playlist" type="checkbox" checked={values.isDynamic === true} onChange={(event) => { const checked = event.target.checked; setValue('isDynamic', checked); if (checked && !values.createdMode) { setCreatedMode('SIMPLE'); setValue('createdMode', 'SIMPLE') } }} /><span>Dynamic playlist (smart collection)</span></label>}
      {showRules && <div className="playlist-editor__advanced">
        <DynamicPlaylistBuilder
          createdMode={createdMode}
          simpleFilter={simpleFilter}
          advancedFilter={advancedFilter}
          sortSpec={sortSpec}
          dynamicMode={dynamicMode}
          onCreatedModeChange={(mode) => { setCreatedMode(mode); setValue('createdMode', mode) }}
          onSimpleFilterChange={(next) => { setSimpleFilter(next); setValue('simpleFilter', next) }}
          onAdvancedFilterChange={(next) => { setAdvancedFilter(next); setValue('advancedFilter', next) }}
          onSortSpecChange={(next) => { setSortSpec(next); setValue('sortSpec', next) }}
          onDynamicModeChange={(mode) => { setDynamicMode(mode); setValue('dynamicMode', mode); setValue('autoUpdate', mode === 'AUTO') }}
        />
      </div>}
      {showReview && <section className="playlist-review" aria-labelledby="playlist-review-title">
        <div className="playlist-review__summary"><span><Sparkles aria-hidden="true" /></span><div><h3 id="playlist-review-title">{values.name}</h3><p>{createdMode === 'SIMPLE' ? 'Simple rules' : 'Advanced nested logic'} · {dynamicMode === 'AUTO' ? 'Auto-updating' : 'Snapshot'} · {values.defaultMode === 'FULL_SIZE' ? 'Full size' : 'TV size'}</p></div><Check aria-hidden="true" /></div>
        <p className="playlist-muted">You can edit the rules, their priority order, and update behavior later from playlist settings.</p>
        <details className="playlist-expert-json">
          <summary>Expert JSON (recovery)</summary>
          <p className="playlist-muted">Use this only to recover a server/mobile spec the builder does not recognize. Structured controls remain the primary editor.</p>
          <JsonEditor label="Filter JSON" value={values.dynamicSpecJson} error={errors.dynamicSpecJson} onChange={(value) => { setValue('dynamicSpecJson', value); setValue('useExpertJson', true) }} placeholder={'{\n  "filterJson": { "type": "liked" },\n  "mode": "AUTO"\n}'} />
          <JsonEditor label="Sort JSON" value={values.dynamicSortJson} error={errors.dynamicSortJson} onChange={(value) => { setValue('dynamicSortJson', value); setValue('useExpertJson', true) }} placeholder={'{\n  "keys": [{ "attribute": "TITLE", "direction": "ASC" }]\n}'} />
          {values.useExpertJson === true && <button type="button" className="playlist-button" onClick={() => setValue('useExpertJson', false)}>Return to builder controls</button>}
        </details>
      </section>}
      {submitError && <p className="playlist-field__error" role="alert">{submitError}</p>}
      {isSmartCreate && wizardStep === 1 && <div className="playlist-editor__wizard-actions"><button type="button" className="playlist-button" onClick={() => setCreationKind(null)}><ArrowLeft size={16} /> Back</button><button type="button" className="playlist-button playlist-button--primary" onClick={continueToRules}>Continue to rules <ArrowRight size={16} /></button></div>}
      {isSmartCreate && wizardStep === 2 && <div className="playlist-editor__wizard-actions"><button type="button" className="playlist-button" onClick={() => setWizardStep(1)}><ArrowLeft size={16} /> Details</button><button type="button" className="playlist-button playlist-button--primary" onClick={() => setWizardStep(3)}>Review playlist <ArrowRight size={16} /></button></div>}
      {(!isSmartCreate || wizardStep === 3) && <div className="playlist-editor__wizard-actions">{isSmartCreate && <button type="button" className="playlist-button" onClick={() => setWizardStep(2)}><ArrowLeft size={16} /> Rules</button>}<button type="submit" className="playlist-button playlist-button--primary" disabled={saving}>{saving ? 'Saving…' : isCreate ? 'Create playlist' : 'Save changes'}</button></div>}
    </form>
  )
}

function SmartPlaylistSteps({ current, onSelect }: { current: 1 | 2 | 3; onSelect: (step: 1 | 2 | 3) => void }) {
  const steps = ['Details', 'Rules', 'Review'] as const
  return <nav className="playlist-wizard-steps" aria-label="Smart playlist steps">{steps.map((label, index) => { const step = (index + 1) as 1 | 2 | 3; return <button key={label} type="button" aria-current={current === step ? 'step' : undefined} onClick={() => step < current && onSelect(step)} disabled={step > current}><span>{step < current ? <Check size={13} /> : step}</span>{label}</button> })}</nav>
}

function JsonEditor({ label, value, error, onChange, placeholder }: { label: string; value: string; error?: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="playlist-field"><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} aria-invalid={Boolean(error)} />{error && <small className="playlist-field__error">{error}</small>}</label>
}

export interface PlaylistItemsEditorProps {
  items: PlaylistEntryModel[]
  onChange: (items: PlaylistEntryModel[]) => void
  readOnly?: boolean
}

export function PlaylistItemsEditor({ items, onChange, readOnly = false }: PlaylistItemsEditorProps) {
  const [itemId, setItemId] = useState('')
  const [itemType, setItemType] = useState<'THEME' | 'SONG'>('THEME')
  const [mode, setMode] = useState<PlaylistPlaybackMode | ''>('')
  const [itemError, setItemError] = useState<string | null>(null)

  const addItem = (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number(itemId)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setItemError('Enter a positive catalog id.')
      return
    }
    onChange([...items, { key: `local:${crypto.randomUUID?.() ?? `${Date.now()}-${items.length}`}`, entryId: null, itemType, itemId: parsed, modeOverride: itemType === 'THEME' && mode ? mode : null }])
    setItemId('')
    setMode('')
    setItemError(null)
  }

  return <section className="playlist-items" aria-labelledby="playlist-items-title"><div className="playlist-items__heading"><h3 id="playlist-items-title">Tracks</h3><span>{items.length}</span></div>{readOnly && <p className="playlist-muted">This smart playlist updates from its filter. Edit the filter to change its tracks.</p>}{items.length === 0 ? <p className="playlist-muted">No tracks in this playlist yet.</p> : <ol className="playlist-items__list">{items.map((item, index) => <li key={item.key}><span className="playlist-item__index">{index + 1}</span><span className="playlist-item__copy"><strong>{item.itemType === 'SONG' ? 'Song' : 'Theme'} #{item.itemId}</strong><small>{item.modeOverride ? `${item.modeOverride === 'FULL_SIZE' ? 'Full size' : 'TV size'} override` : 'Uses playlist default'}</small></span>{!readOnly && <><button type="button" className="playlist-icon-button" aria-label={`Move ${item.itemType.toLowerCase()} ${item.itemId} up`} disabled={index === 0} onClick={() => onChange(reorderPlaylistItems(items, item.key, -1))}>↑</button><button type="button" className="playlist-icon-button" aria-label={`Move ${item.itemType.toLowerCase()} ${item.itemId} down`} disabled={index === items.length - 1} onClick={() => onChange(reorderPlaylistItems(items, item.key, 1))}>↓</button><button type="button" className="playlist-icon-button playlist-icon-button--danger" aria-label={`Remove ${item.itemType.toLowerCase()} ${item.itemId} from playlist`} onClick={() => onChange(removePlaylistItem(items, item.key))}>×</button></>}</li>)}</ol>}{!readOnly && <form className="playlist-add-item" onSubmit={addItem}><label className="playlist-field"><span>Type</span><select value={itemType} onChange={(event) => setItemType(event.target.value as 'THEME' | 'SONG')}><option value="THEME">Theme</option><option value="SONG">Related song</option></select></label><label className="playlist-field"><span>Catalog id</span><input inputMode="numeric" value={itemId} onChange={(event) => setItemId(event.target.value)} /></label>{itemType === 'THEME' && <label className="playlist-field"><span>Mode override</span><select value={mode} onChange={(event) => setMode(event.target.value as PlaylistPlaybackMode | '')}><option value="">Playlist default</option><option value="TV_SIZE">TV size</option><option value="FULL_SIZE">Full size</option></select></label>}<button type="submit" className="playlist-button">Add track</button></form>}{itemError && <p className="playlist-field__error" role="alert">{itemError}</p>}</section>
}

export interface PlaylistDetailProps {
  playlist: PlaylistDto
  library?: NormalizedLibrary | null
  onUpdate: (id: number, input: Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] }) => Promise<unknown> | unknown
  onDelete: (id: number) => Promise<unknown> | unknown
  onBack?: () => void
  onPlay?: (playlist: PlaylistDto, shuffle: boolean) => void
  onPlayItem?: (playlist: PlaylistDto, index: number) => void
  onPlayNextItem?: (playlist: PlaylistDto, index: number) => void
  onAddToQueueItem?: (playlist: PlaylistDto, index: number) => void
  onPlayNext?: (playlist: PlaylistDto) => void
  onAddToQueue?: (playlist: PlaylistDto) => void
  onReplaceQueue?: (playlist: PlaylistDto) => void
  onRefresh?: (playlist: PlaylistDto) => Promise<unknown> | unknown
  onNavigateToArtist?: (artistName: string) => void
  onNavigateToAnime?: (animeId: string) => void
}

export function PlaylistDetail({ playlist, library: providedLibrary, onUpdate, onDelete, onBack, onPlay, onPlayItem, onPlayNextItem, onAddToQueueItem, onPlayNext, onAddToQueue, onReplaceQueue, onRefresh, onNavigateToArtist, onNavigateToAnime }: PlaylistDetailProps) {
  const titlePreference = useAnimeTitlePreference()
  const queriedLibrary = useLibraryQuery({ enabled: false }).library
  const library = providedLibrary ?? queriedLibrary
  const songIndex = useMemo(() => buildPlaylistSongIndex(library), [library])
  const rows = useMemo(() => resolvePlaylistDisplayItems(playlist, library, songIndex, titlePreference), [library, playlist, songIndex, titlePreference])
  const [visibleTrackCount, setVisibleTrackCount] = useState(PLAYLIST_TRACK_PAGE_SIZE)
  const editableItems = useMemo(() => normalizePlaylistItems(playlist), [playlist])
  const artworkUrls = useMemo(() => playlistArtworkUrls(playlist, library), [library, playlist])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const editDialogRef = useAccessibleFocusScope<HTMLDivElement>({ active: editorOpen, onEscape: () => setEditorOpen(false) })
  const deleteDialogRef = useAccessibleFocusScope<HTMLDivElement>({ active: confirmingDelete, onEscape: () => setConfirmingDelete(false) })
  const sourceItems = useMemo(() => rows.filter((row) => row.available).map((row) => ({ itemType: row.itemType, itemId: row.itemId, modeOverride: row.itemType === 'THEME' ? row.modeOverride : null })), [rows])
  const canManage = !playlist.isAuto

  useEffect(() => setVisibleTrackCount(PLAYLIST_TRACK_PAGE_SIZE), [playlist.id, playlist.updatedAt])

  const confirmDelete = async () => {
    setDeleting(true)
    setError(null)
    try { await onDelete(playlist.id) } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete playlist.')
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }
  const removeItem = async (index: number) => {
    const sourceItems = playlist.items.length > 0 ? playlist.items : playlist.entries.map((itemId, itemIndex) => ({ entryId: itemIndex + 1, itemType: 'THEME' as const, itemId, modeOverride: null }))
    await onUpdate(playlist.id, { items: sourceItems.filter((_, itemIndex) => itemIndex !== index) })
  }
  const moveItem = async (index: number, delta: -1 | 1) => {
    if (playlist.isAuto || playlist.isDynamic) return
    const current = editableItems[index]
    if (!current) return
    const reordered = reorderPlaylistItems(editableItems, current.key, delta)
    if (reordered[index]?.key === current.key) return
    setError(null)
    try {
      await onUpdate(playlist.id, { items: toPlaylistItemInputs(reordered) })
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not reorder playlist.')
    }
  }
  const refreshSnapshot = async () => {
    if (!onRefresh || !isSnapshotPlaylist(playlist)) return
    setRefreshing(true)
    setError(null)
    try { await onRefresh(playlist) } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh playlist.')
    } finally { setRefreshing(false) }
  }

  return (
    <section className="playlist-detail playlist-detail--catalog" aria-labelledby="playlist-detail-title">
      {onBack && <button type="button" className="playlist-button playlist-button--quiet playlist-detail__back" onClick={onBack}><ArrowLeft size={16} /> All playlists</button>}
      <header className="playlist-detail__hero">
        {artworkUrls[0] && <div className="playlist-detail__backdrop" data-testid="playlist-hero-backdrop" style={{ backgroundImage: `url(${JSON.stringify(artworkUrls[0])})` }} aria-hidden="true" />}
        <PlaylistArtwork playlistId={playlist.id} name={playlist.name} artworkUrls={artworkUrls} className="playlist-detail__collage" />
        <div className="playlist-detail__copy">
          <p className="playlist-eyebrow">{playlist.isDynamic ? 'Smart playlist' : playlist.isAuto ? 'Auto playlist' : 'Playlist'}</p>
          <h1 id="playlist-detail-title">{playlist.name}</h1>
          <p>{rows.length} {rows.length === 1 ? 'track' : 'tracks'} · {playlist.defaultMode === 'FULL_SIZE' ? 'Full size' : 'TV size'} default{playlist.isDynamic && playlist.autoUpdate ? ' · Auto-updating' : ''}</p>
          <div className="playlist-detail__actions">
            {onPlay && <><button type="button" className="playlist-button playlist-button--primary" onClick={() => onPlay(playlist, false)} disabled={rows.length === 0}><Play size={17} fill="currentColor" /> Play all</button><button type="button" className="playlist-button" onClick={() => onPlay(playlist, true)} disabled={rows.length === 0}><Shuffle size={17} /> Shuffle</button></>}
            <CollectionActionMenu name={playlist.name} items={sourceItems} excludePlaylistId={playlist.id} onPlayNext={onPlayNext && rows.length > 0 ? () => onPlayNext(playlist) : undefined} onAddToQueue={onAddToQueue && rows.length > 0 ? () => onAddToQueue(playlist) : undefined} onReplaceQueue={onReplaceQueue && rows.length > 0 ? () => onReplaceQueue(playlist) : undefined} onRefresh={onRefresh && isSnapshotPlaylist(playlist) && !refreshing ? () => void refreshSnapshot() : undefined} refreshLabel={refreshing ? 'Refreshing…' : 'Refresh now'} onEdit={canManage ? () => setEditorOpen(true) : undefined} onDelete={canManage ? () => setConfirmingDelete(true) : undefined} />
          </div>
        </div>
      </header>
      {error && <p className="playlist-field__error" role="alert">{error}</p>}
      <section className="playlist-track-section" aria-labelledby="playlist-tracks-title">
        <div className="playlist-items__heading"><div><p className="playlist-eyebrow">Playlist sequence</p><h2 id="playlist-tracks-title">Tracks</h2></div><span>{rows.length}</span></div>
        {rows.length === 0 ? <p className="playlist-muted">This playlist is empty. Add tracks from a song’s action menu.</p> : <>
          <ol className="playlist-track-list" aria-label="Playlist tracks" aria-setsize={rows.length}>{rows.slice(0, visibleTrackCount).map((row, index) => { const destinations = playlistTrackDestinations(row.itemType, row.itemId, library, songIndex); return <li key={row.key} aria-posinset={index + 1} className={['playlist-track-row', !row.available && 'playlist-track-row--unavailable', !playlist.isAuto && !playlist.isDynamic && 'playlist-track-row--reorderable'].filter(Boolean).join(' ')}><span className="playlist-track-row__number">{index + 1}</span><button type="button" className="playlist-track-row__play" onClick={() => onPlayItem?.(playlist, index)} disabled={!row.available || !onPlayItem} aria-label={`Play ${row.title}`}>{row.artworkUrl ? <img src={row.artworkUrl} alt="" loading="lazy" /> : <span aria-hidden="true"><Music2 size={20} /></span>}<i aria-hidden="true"><Play size={17} fill="currentColor" /></i></button><span className="playlist-track-row__copy"><strong>{row.title}</strong><small>{row.subtitle}</small></span><span className="playlist-track-row__features">{row.available ? <>{row.hasFullSize && row.itemType === 'THEME' && <span>Full size</span>}{row.hasVideo && <span>Video</span>}</> : <span>Unavailable</span>}</span><PlaylistTrackDuration value={row.durationSeconds} />{!playlist.isAuto && !playlist.isDynamic && <span className="playlist-track-row__reorder"><button type="button" className="playlist-icon-button" aria-label={`Move ${row.title} up`} disabled={index === 0} onClick={() => void moveItem(index, -1)}>↑</button><button type="button" className="playlist-icon-button" aria-label={`Move ${row.title} down`} disabled={index === rows.length - 1} onClick={() => void moveItem(index, 1)}>↓</button></span>}<TrackActionMenu menuOnly item={{ itemType: row.itemType, itemId: row.itemId, title: row.title, modeOverride: row.modeOverride }} liked={row.liked} disliked={row.disliked} onPlayNext={row.available && onPlayNextItem ? () => onPlayNextItem(playlist, index) : undefined} onAddToQueue={row.available && onAddToQueueItem ? () => onAddToQueueItem(playlist, index) : undefined} onGoToArtist={destinations.artistName && onNavigateToArtist ? () => onNavigateToArtist(destinations.artistName!) : undefined} artistName={destinations.artistName} onGoToAnime={destinations.animeId && onNavigateToAnime ? () => onNavigateToAnime(destinations.animeId!) : undefined} animeName={destinations.animeName} onRemove={!playlist.isAuto ? () => { void removeItem(index) } : undefined} /></li> })}</ol>
          {rows.length > visibleTrackCount && <div className="playlist-track-list__pagination"><p className="playlist-muted">Showing {Math.min(visibleTrackCount, rows.length)} of {rows.length} tracks.</p><button type="button" className="playlist-button" onClick={() => setVisibleTrackCount((current) => Math.min(current + PLAYLIST_TRACK_PAGE_SIZE, rows.length))}>Load more playlist tracks</button></div>}
        </>}
      </section>
      {editorOpen && <div className="playlist-dialog-backdrop"><div ref={editDialogRef} className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-edit-dialog-title"><PlaylistEditor playlist={playlist} onCancel={() => setEditorOpen(false)} onSubmit={async (input) => { await onUpdate(playlist.id, input as Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] }); setEditorOpen(false) }} /></div></div>}
      {confirmingDelete && <div className="playlist-dialog-backdrop"><div ref={deleteDialogRef} className="playlist-dialog playlist-dialog--confirm" role="dialog" aria-modal="true" aria-labelledby="playlist-delete-dialog-title"><h2 id="playlist-delete-dialog-title">Delete playlist?</h2><p>This removes “{playlist.name}” from your library. The tracks themselves will stay available.</p><div className="playlist-dialog__actions"><button type="button" className="playlist-button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Keep playlist</button><button type="button" className="playlist-button playlist-button--danger" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button></div></div></div>}
    </section>
  )
}

function playlistTrackDestinations(itemType: 'THEME' | 'SONG', itemId: number, library: NormalizedLibrary | null | undefined, songIndex: ReturnType<typeof buildPlaylistSongIndex>): { artistName: string | null; animeId: string | null; animeName: string | null } {
  if (itemType === 'SONG') {
    const found = songIndex.get(itemId)
    return { artistName: found?.song.artistCredit || found?.release.artistCredit || null, animeId: found?.animeId ?? null, animeName: found?.anime.title ?? found?.anime.titleEn ?? null }
  }
  const theme = library?.themesById[String(itemId)]
  const anime = theme?.kitsuAnimeIds.map((id) => library?.animeById[id]).find((candidate) => candidate && !candidate.deleted)
  return { artistName: theme?.artists.map((artist) => artist.name).filter(Boolean).join(', ') || null, animeId: anime?.kitsuId ?? null, animeName: anime?.title ?? anime?.titleEn ?? null }
}

function PlaylistTrackDuration({ value }: { value: number | null }) {
  const duration = formatPlaylistDuration(value)
  return duration ? <time>{duration}</time> : null
}

function formatPlaylistDuration(value: number | null): string | null {
  if (!value || value <= 0) return null
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function isSnapshotPlaylist(playlist: PlaylistDto): boolean {
  return playlist.isDynamic && !playlist.autoUpdate && deserializeDynamicSpec(playlist.dynamicSpecJson).mode === 'SNAPSHOT'
}

export interface PlaylistManagerProps extends Omit<PlaylistListProps, 'onCreate' | 'onPlay'> {
  initialCreate?: boolean
  onCreate: (input: PlaylistCreateInput) => Promise<unknown> | unknown
  onUpdate: PlaylistDetailProps['onUpdate']
  onDelete: (playlist: PlaylistDto) => Promise<unknown> | unknown
  onPlay?: PlaylistDetailProps['onPlay']
}

export function PlaylistManager({ playlists, state, error, onCreate, onUpdate, onDelete, onPlay, maxVisible, initialCreate = false }: PlaylistManagerProps) {
  const [creating, setCreating] = useState(initialCreate)
  const [editingPlaylist, setEditingPlaylist] = useState<PlaylistDto | null>(null)
  const [deletingPlaylist, setDeletingPlaylist] = useState<PlaylistDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const createInitialFocusRef = useRef<HTMLButtonElement>(null)
  const createDialogRef = useAccessibleFocusScope<HTMLDivElement>({ active: creating, onEscape: () => setCreating(false), initialFocusRef: createInitialFocusRef })
  const editDialogRef = useAccessibleFocusScope<HTMLDivElement>({ active: editingPlaylist !== null, onEscape: () => setEditingPlaylist(null) })
  const deleteDialogRef = useAccessibleFocusScope<HTMLDivElement>({ active: deletingPlaylist !== null, onEscape: () => setDeletingPlaylist(null) })
  useEffect(() => {
    if (initialCreate) setCreating(true)
  }, [initialCreate])
  const create = async (input: PlaylistCreateInput | (Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] })) => { await onCreate(input as PlaylistCreateInput); setCreating(false) }
  const edit = async (input: PlaylistCreateInput | (Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] })) => {
    if (!editingPlaylist) return
    await onUpdate(editingPlaylist.id, input as Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] })
    setEditingPlaylist(null)
  }
  const confirmDelete = async () => {
    if (!deletingPlaylist) return
    setDeleting(true)
    setDialogError(null)
    try {
      await onDelete(deletingPlaylist)
      setDeletingPlaylist(null)
    } catch (deleteError) {
      setDialogError(deleteError instanceof Error ? deleteError.message : 'Could not delete playlist.')
    } finally {
      setDeleting(false)
    }
  }

  return <div className="playlist-manager"><PlaylistList playlists={playlists} state={state} error={error} maxVisible={maxVisible} onCreate={() => setCreating(true)} onPlay={onPlay ? (playlist) => onPlay(playlist, false) : undefined} onEdit={(playlist) => { setDialogError(null); setEditingPlaylist(playlist) }} onRequestDelete={(playlist) => { setDialogError(null); setDeletingPlaylist(playlist) }} />{creating && <div className="playlist-dialog-backdrop"><div ref={createDialogRef} className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-create-dialog-title"><h2 id="playlist-create-dialog-title" className="sr-only">Create playlist</h2><PlaylistEditor initialFocusRef={createInitialFocusRef} onCancel={() => setCreating(false)} onSubmit={create} /></div></div>}{editingPlaylist && <div className="playlist-dialog-backdrop"><div ref={editDialogRef} className="playlist-dialog" role="dialog" aria-modal="true" aria-label={`Edit ${editingPlaylist.name}`}><PlaylistEditor playlist={editingPlaylist} onCancel={() => setEditingPlaylist(null)} onSubmit={edit} /></div></div>}{deletingPlaylist && <div className="playlist-dialog-backdrop"><div ref={deleteDialogRef} className="playlist-dialog playlist-dialog--confirm" role="dialog" aria-modal="true" aria-label={`Delete ${deletingPlaylist.name}`}><h2>Delete playlist?</h2><p>This removes “{deletingPlaylist.name}” from your library. The tracks themselves will stay available.</p>{dialogError && <p className="playlist-field__error" role="alert">{dialogError}</p>}<div className="playlist-dialog__actions"><button type="button" className="playlist-button" onClick={() => setDeletingPlaylist(null)} disabled={deleting}>Keep playlist</button><button type="button" className="playlist-button playlist-button--danger" onClick={() => void confirmDelete()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button></div></div></div>}</div>
}

function editorValuesFor(playlist: PlaylistDto): PlaylistEditorValues {
  return {
    name: playlist.name,
    defaultMode: playlist.defaultMode,
    overrideUserPreference: playlist.overrideUserPreference,
    autoUpdate: playlist.autoUpdate,
    dynamicSpecJson: formatJsonEditorValue(playlist.dynamicSpecJson),
    dynamicSortJson: formatJsonEditorValue(playlist.dynamicSortJson),
    isDynamic: playlist.isDynamic,
  }
}

function structuredEditorFor(playlist?: PlaylistDto): {
  createdMode: DynamicCreatedMode
  dynamicMode: DynamicPlaylistMode
  simpleFilter: SimpleFilterState
  advancedFilter: FilterNodeJson
  sortSpec: SortSpecJson
} {
  if (!playlist?.isDynamic) {
    return {
      createdMode: 'SIMPLE',
      dynamicMode: 'AUTO',
      simpleFilter: createDefaultSimpleFilter(),
      advancedFilter: DEFAULT_ADVANCED_FILTER,
      sortSpec: DEFAULT_SORT_SPEC,
    }
  }
  const spec = deserializeDynamicSpec(playlist.dynamicSpecJson)
  return {
    createdMode: spec.createdMode,
    dynamicMode: playlist.autoUpdate ? 'AUTO' : spec.mode === 'SNAPSHOT' ? 'SNAPSHOT' : 'SNAPSHOT',
    simpleFilter: spec.simpleFilter ?? createDefaultSimpleFilter(),
    advancedFilter: spec.filter,
    sortSpec: playlist.dynamicSortJson === null ? spec.sort : deserializeSortSpec(playlist.dynamicSortJson),
  }
}

export function validateEditorJson(value: string, label: string): unknown {
  return parseJsonEditorValue(value, label)
}

export function PlaylistFeatureMessage({ children }: { children: ReactNode }) {
  return <p className="playlist-muted">{children}</p>
}
