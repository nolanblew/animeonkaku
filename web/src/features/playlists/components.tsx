import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PlaylistDto, PlaylistPlaybackMode } from '../../lib/library'
import { buildPlaylistUpdate, formatJsonEditorValue, normalizePlaylistItems, parseJsonEditorValue, removePlaylistItem, reorderPlaylistItems, sanitizePlaylistName, validatePlaylistForm, type PlaylistEditorValues, type PlaylistEntryModel, type PlaylistFormErrors, type PlaylistUpdateInput } from './model'
import type { PlaylistCreateInput } from './api'
import './playlists.css'

export type PlaylistListState = 'loading' | 'ready' | 'empty' | 'error'

export interface PlaylistListProps {
  playlists: PlaylistDto[]
  state: PlaylistListState
  error?: string
  onCreate: () => void
  onSelect?: (id: number) => void
  maxVisible?: number
}

export function PlaylistList({ playlists, state, error, onCreate, onSelect, maxVisible = 100 }: PlaylistListProps) {
  const [filter, setFilter] = useState('')
  const visible = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return playlists
      .filter((playlist) => !playlist.deleted && (query.length === 0 || playlist.name.toLocaleLowerCase().includes(query)))
      .slice(0, Math.max(1, maxVisible))
  }, [filter, maxVisible, playlists])

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
        <input aria-label="Filter playlists" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search your playlists" />
      </label>
      {state === 'loading' && <p className="playlist-state" role="status">Loading playlists…</p>}
      {state === 'error' && <p className="playlist-state playlist-state--error" role="alert">{error ?? 'Could not load playlists.'}</p>}
      {state !== 'loading' && state !== 'error' && visible.length === 0 && <div className="playlist-empty"><strong>No playlists yet</strong><span>Create a playlist to keep your favorite themes together.</span><button type="button" className="playlist-button" onClick={onCreate}>Create playlist</button></div>}
      {state !== 'loading' && state !== 'error' && visible.length > 0 && (
        <>
          <div className="playlist-cards">
            {visible.map((playlist) => <Link className="playlist-card" to={`/playlist/${playlist.id}`} key={playlist.id} onClick={(event) => { if (onSelect) { event.preventDefault(); onSelect(playlist.id) } }}>
              <span className="playlist-card__art" aria-hidden="true">{playlist.isDynamic ? '✦' : '♫'}</span>
              <span className="playlist-card__copy"><strong>{playlist.name}</strong><small>{playlist.isDynamic ? 'Smart playlist' : `${playlist.items.length || playlist.entries.length} tracks`}</small></span>
              <span className="playlist-card__arrow" aria-hidden="true">→</span>
            </Link>)}
          </div>
          {playlists.filter((playlist) => !playlist.deleted && (filter.trim().length === 0 || playlist.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))).length > visible.length && <p className="playlist-list__count">Showing {visible.length} of {playlists.length} playlists. Refine the filter to find another playlist.</p>}
        </>
      )}
    </section>
  )
}

export interface PlaylistEditorProps {
  playlist?: PlaylistDto
  onSubmit: (input: PlaylistCreateInput | (Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] })) => Promise<unknown> | unknown
  onCancel?: () => void
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

export function PlaylistEditor({ playlist, onSubmit, onCancel }: PlaylistEditorProps) {
  const [values, setValues] = useState<PlaylistEditorValues>(() => playlist ? editorValuesFor(playlist) : emptyEditorValues)
  const [items, setItems] = useState<PlaylistEntryModel[]>(() => playlist ? normalizePlaylistItems(playlist) : [])
  const [errors, setErrors] = useState<PlaylistFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setValues(playlist ? editorValuesFor(playlist) : emptyEditorValues)
    setItems(playlist ? normalizePlaylistItems(playlist) : [])
  }, [playlist])

  const isCreate = playlist === undefined
  const setValue = <K extends keyof PlaylistEditorValues>(key: K, value: PlaylistEditorValues[K]) => setValues((current) => ({ ...current, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = validatePlaylistForm(values)
    setErrors(nextErrors)
    setSubmitError(null)
    if (Object.keys(nextErrors).length > 0) return
    setSaving(true)
    try {
      const update = buildPlaylistUpdate(values, items)
      await onSubmit(isCreate ? { ...update, name: sanitizePlaylistName(values.name) } : update)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not save playlist.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="playlist-editor" onSubmit={submit} noValidate>
      <div className="playlist-editor__heading"><div><p className="playlist-eyebrow">{isCreate ? 'New collection' : 'Playlist settings'}</p><h2>{isCreate ? 'Create playlist' : 'Edit playlist'}</h2></div>{onCancel && <button type="button" className="playlist-button playlist-button--quiet" onClick={onCancel}>Cancel</button>}</div>
      <label className="playlist-field"><span>Name</span><input aria-label="Playlist name" value={values.name} maxLength={100} onChange={(event) => setValue('name', event.target.value)} autoComplete="off" />{errors.name && <small className="playlist-field__error">{errors.name}</small>}</label>
      <div className="playlist-editor__grid">
        <label className="playlist-field"><span>Default playback</span><select value={values.defaultMode} onChange={(event) => setValue('defaultMode', event.target.value as PlaylistPlaybackMode)}><option value="TV_SIZE">TV size</option><option value="FULL_SIZE">Full size</option></select></label>
        <label className="playlist-check"><input type="checkbox" checked={values.overrideUserPreference} onChange={(event) => setValue('overrideUserPreference', event.target.checked)} /><span>Use this mode over song preferences</span></label>
      </div>
      <label className="playlist-check"><input aria-label="Dynamic playlist" type="checkbox" checked={values.isDynamic === true} onChange={(event) => setValue('isDynamic', event.target.checked)} /><span>Dynamic playlist (smart collection)</span></label>
      {values.isDynamic === true && <div className="playlist-editor__advanced">
        <label className="playlist-check"><input type="checkbox" checked={values.autoUpdate} onChange={(event) => setValue('autoUpdate', event.target.checked)} /><span>Update automatically when the library changes</span></label>
        <JsonEditor label="Filter JSON" value={values.dynamicSpecJson} error={errors.dynamicSpecJson} onChange={(value) => setValue('dynamicSpecJson', value)} placeholder={'{\n  "type": "liked"\n}'} />
        <JsonEditor label="Sort JSON" value={values.dynamicSortJson} error={errors.dynamicSortJson} onChange={(value) => setValue('dynamicSortJson', value)} placeholder={'{\n  "keys": [{ "attribute": "TITLE", "direction": "ASC" }]\n}'} />
      </div>}
      {!isCreate && <PlaylistItemsEditor items={items} onChange={setItems} />}
      {submitError && <p className="playlist-field__error" role="alert">{submitError}</p>}
      <button type="submit" className="playlist-button playlist-button--primary" disabled={saving}>{saving ? 'Saving…' : isCreate ? 'Create playlist' : 'Save changes'}</button>
    </form>
  )
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
  onUpdate: (id: number, input: Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] }) => Promise<unknown> | unknown
  onDelete: (id: number) => Promise<unknown> | unknown
  onBack?: () => void
}

export function PlaylistDetail({ playlist, onUpdate, onDelete, onBack }: PlaylistDetailProps) {
  const [items, setItems] = useState(() => normalizePlaylistItems(playlist))
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => setItems(normalizePlaylistItems(playlist)), [playlist])

  async function saveItems(next: PlaylistEntryModel[]) {
    setItems(next)
    setError(null)
    try {
      await onUpdate(playlist.id, { items: next.map((item) => ({ ...(item.entryId !== null ? { entryId: item.entryId } : {}), itemType: item.itemType, itemId: item.itemId, modeOverride: item.modeOverride })) })
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update tracks.')
    }
  }

  async function confirmDelete() {
    setDeleting(true)
    setError(null)
    try { await onDelete(playlist.id) } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Could not delete playlist.'); setDeleting(false); setConfirmingDelete(false) }
  }

  return <section className="playlist-detail" aria-labelledby="playlist-detail-title">{onBack && <button type="button" className="playlist-button playlist-button--quiet" onClick={onBack}>← All playlists</button>}<header className="playlist-detail__header"><div className="playlist-detail__art" aria-hidden="true">{playlist.isDynamic ? '✦' : '♫'}</div><div className="playlist-detail__copy"><p className="playlist-eyebrow">{playlist.isDynamic ? 'Smart playlist' : 'Playlist'}</p><h1 id="playlist-detail-title">{playlist.name}</h1><p>{items.length} {items.length === 1 ? 'track' : 'tracks'} · {playlist.defaultMode === 'FULL_SIZE' ? 'Full size' : 'TV size'} default</p></div><div className="playlist-detail__actions">{!playlist.isAuto && <button type="button" className="playlist-button" onClick={() => setEditorOpen(true)}>Edit</button>}{!playlist.isAuto && <button type="button" className="playlist-button playlist-button--danger" onClick={() => setConfirmingDelete(true)}>Delete playlist</button>}</div></header>{error && <p className="playlist-field__error" role="alert">{error}</p>}<PlaylistItemsEditor items={items} onChange={saveItems} readOnly={playlist.isDynamic && playlist.autoUpdate} />{editorOpen && <div className="playlist-dialog-backdrop"><div className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-edit-dialog-title"><PlaylistEditor playlist={playlist} onCancel={() => setEditorOpen(false)} onSubmit={async (input) => { await onUpdate(playlist.id, input as Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] }); setEditorOpen(false) }} /></div></div>}{confirmingDelete && <div className="playlist-dialog-backdrop"><div className="playlist-dialog playlist-dialog--confirm" role="dialog" aria-modal="true" aria-labelledby="playlist-delete-dialog-title"><h2 id="playlist-delete-dialog-title">Delete playlist?</h2><p>This removes “{playlist.name}” from your library. The tracks themselves will stay available.</p><div className="playlist-dialog__actions"><button type="button" className="playlist-button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Keep playlist</button><button type="button" className="playlist-button playlist-button--danger" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button></div></div></div>}</section>
}

export interface PlaylistManagerProps extends Omit<PlaylistListProps, 'onCreate'> {
  onCreate: (input: PlaylistCreateInput) => Promise<unknown> | unknown
  onUpdate: PlaylistDetailProps['onUpdate']
  onDelete: PlaylistDetailProps['onDelete']
}

export function PlaylistManager({ playlists, state, error, onCreate, onUpdate, onDelete, maxVisible }: PlaylistManagerProps) {
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = selectedId === null ? null : playlists.find((playlist) => playlist.id === selectedId && !playlist.deleted) ?? null
  const create = async (input: PlaylistCreateInput | (Partial<PlaylistUpdateInput> & { items?: PlaylistUpdateInput['items'] })) => { await onCreate(input as PlaylistCreateInput); setCreating(false) }

  return <div className="playlist-manager">{!selected && <PlaylistList playlists={playlists} state={state} error={error} maxVisible={maxVisible} onCreate={() => setCreating(true)} onSelect={setSelectedId} />}{selected && <PlaylistDetail playlist={selected} onUpdate={onUpdate} onDelete={async (id) => { await onDelete(id); setSelectedId(null) }} onBack={() => setSelectedId(null)} />}{creating && <div className="playlist-dialog-backdrop"><div className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-create-dialog-title"><h2 id="playlist-create-dialog-title" className="sr-only">Create playlist</h2><PlaylistEditor onCancel={() => setCreating(false)} onSubmit={create} /></div></div>}</div>
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

export function validateEditorJson(value: string, label: string): unknown {
  return parseJsonEditorValue(value, label)
}

export function PlaylistFeatureMessage({ children }: { children: ReactNode }) {
  return <p className="playlist-muted">{children}</p>
}
