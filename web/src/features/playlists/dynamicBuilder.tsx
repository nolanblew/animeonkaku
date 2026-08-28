import { useMemo } from 'react'
import {
  compileSimpleFilter,
  validateFilterNode,
  validateSortSpec,
  type DynamicCreatedMode,
  type DynamicPlaylistMode,
  type FilterNodeJson,
  type SimpleFilterState,
  type SortKeyJson,
  type SortSpecJson,
} from './model'

export interface DynamicBuilderProps {
  createdMode: DynamicCreatedMode
  simpleFilter: SimpleFilterState
  advancedFilter: FilterNodeJson
  sortSpec: SortSpecJson
  dynamicMode: DynamicPlaylistMode
  onCreatedModeChange: (mode: DynamicCreatedMode) => void
  onSimpleFilterChange: (filter: SimpleFilterState) => void
  onAdvancedFilterChange: (filter: FilterNodeJson) => void
  onSortSpecChange: (sort: SortSpecJson) => void
  onDynamicModeChange: (mode: DynamicPlaylistMode) => void
}

const FIELD_OPTIONS: Array<{ type: string; label: string }> = [
  { type: 'liked', label: 'Liked' },
  { type: 'disliked', label: 'Disliked' },
  { type: 'downloaded', label: 'Downloaded' },
  { type: 'genre_in', label: 'Genre' },
  { type: 'aired_on', label: 'Aired date' },
  { type: 'season_in', label: 'Season' },
  { type: 'subtype_in', label: 'Media type' },
  { type: 'average_rating_gte', label: 'Average rating' },
  { type: 'user_rating_gte', label: 'My rating' },
  { type: 'watching_status_in', label: 'Watching status' },
  { type: 'theme_type_in', label: 'Theme type' },
  { type: 'artist_in', label: 'Artist' },
  { type: 'title_matches', label: 'Anime title' },
  { type: 'song_title_matches', label: 'Song title' },
  { type: 'play_count_gte', label: 'Play count' },
  { type: 'played_on', label: 'Last played date' },
  { type: 'watched_on', label: 'Watched date' },
]

const SORT_ATTRIBUTES = [
  ['WATCHED_DATE', 'Watched date'],
  ['TITLE', 'Song title'],
  ['ANIME_TITLE', 'Anime title'],
  ['ARTIST', 'Artist'],
  ['THEME_TYPE', 'Theme type'],
  ['THEME_ORDER_GROUPED', 'Theme order (grouped)'],
  ['THEME_ORDER_INTERLEAVED', 'Theme order (interleaved)'],
  ['AIRED_DATE', 'Aired date'],
  ['AVERAGE_RATING', 'Average rating'],
  ['MY_RATING', 'My rating'],
  ['PLAY_COUNT', 'Play count'],
  ['LAST_PLAYED', 'Last played'],
  ['LIKED', 'Liked'],
  ['DOWNLOADED', 'Downloaded'],
  ['RANDOM', 'Random'],
  ['WATCHING_STATUS', 'Watching status'],
  ['SUBTYPE', 'Media type'],
  ['SEASON', 'Season'],
] as const

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
const SUBTYPES = ['tv', 'movie', 'ova', 'ona', 'special', 'music']
const STATUSES = [['current', 'Current'], ['completed', 'Completed'], ['planned', 'Planned'], ['on_hold', 'On hold'], ['dropped', 'Dropped']] as const
const THEME_TYPES = [['OP', 'Opening'], ['ED', 'Ending'], ['IN', 'Insert']] as const

export function DynamicPlaylistBuilder(props: DynamicBuilderProps) {
  const filterErrors = useMemo(() => props.createdMode === 'SIMPLE'
    ? validateFilterNode(compileSimpleFilter(props.simpleFilter), true, true)
    : validateFilterNode(props.advancedFilter), [props.advancedFilter, props.createdMode, props.simpleFilter])
  const sortErrors = useMemo(() => validateSortSpec(props.sortSpec), [props.sortSpec])

  return (
    <section className="playlist-builder" aria-labelledby="playlist-builder-title">
      <div className="playlist-builder__heading">
        <div>
          <p className="playlist-eyebrow">Smart playlist</p>
          <h3 id="playlist-builder-title">Build the rules</h3>
        </div>
        <span className="playlist-builder__preview" role="status">
          {filterErrors.length === 0 ? 'Valid filter' : filterErrors[0]}
        </span>
      </div>

      <fieldset className="playlist-builder__mode">
        <legend>Builder mode</legend>
        <label className="playlist-radio"><input type="radio" name="dynamic-builder-mode" checked={props.createdMode === 'SIMPLE'} onChange={() => props.onCreatedModeChange('SIMPLE')} /><span>Simple</span></label>
        <label className="playlist-radio"><input type="radio" name="dynamic-builder-mode" checked={props.createdMode === 'ADVANCED'} onChange={() => props.onCreatedModeChange('ADVANCED')} /><span>Advanced logic</span></label>
      </fieldset>

      <fieldset className="playlist-builder__mode">
        <legend>When should this playlist update?</legend>
        <label className="playlist-radio"><input type="radio" name="dynamic-update-mode" checked={props.dynamicMode === 'AUTO'} onChange={() => props.onDynamicModeChange('AUTO')} /><span>Auto-update from the library</span></label>
        <label className="playlist-radio"><input type="radio" name="dynamic-update-mode" checked={props.dynamicMode === 'SNAPSHOT'} onChange={() => props.onDynamicModeChange('SNAPSHOT')} /><span>Snapshot these tracks now</span></label>
        <small className="playlist-muted">{props.dynamicMode === 'AUTO' ? 'The server evaluates the filter and owns the entries.' : 'The filter is saved for reference; the current tracks are kept as a fixed snapshot.'}</small>
      </fieldset>

      {props.createdMode === 'SIMPLE'
        ? <SimpleFilterBuilder value={props.simpleFilter} onChange={props.onSimpleFilterChange} />
        : <AdvancedFilterBuilder value={props.advancedFilter} onChange={props.onAdvancedFilterChange} />}

      <SortBuilder value={props.sortSpec} onChange={props.onSortSpecChange} errors={sortErrors} />
    </section>
  )
}

interface SimpleFilterBuilderProps {
  value: SimpleFilterState
  onChange: (value: SimpleFilterState) => void
}

function SimpleFilterBuilder({ value, onChange }: SimpleFilterBuilderProps) {
  const update = <K extends keyof SimpleFilterState>(key: K, next: SimpleFilterState[K]) => onChange({ ...value, [key]: next })
  const toggle = (key: 'seasons' | 'genreSlugs' | 'subtypes' | 'watchingStatuses' | 'themeTypes', item: string) => {
    const current = value[key]
    update(key, current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item])
  }
  return (
    <div className="playlist-builder__simple">
      <fieldset className="playlist-builder__section">
        <legend>Time period</legend>
        <div className="playlist-choice-row">
          {(['AIRED', 'WATCHED'] as const).map((dimension) => <label className="playlist-radio" key={dimension}><input type="radio" name="simple-time-dimension" checked={value.timeDimension === dimension} onChange={() => update('timeDimension', dimension)} /><span>{dimension === 'AIRED' ? 'Aired' : 'Watched'}</span></label>)}
        </div>
        <label className="playlist-field"><span>Time range</span><select value={value.timeMode} onChange={(event) => update('timeMode', event.target.value as SimpleFilterState['timeMode'])}><option value="ANY">Any time</option><option value="LAST_6_MONTHS">Last 6 months</option><option value="LAST_2_YEARS">Last 2 years</option><option value="BEFORE_2000">Before 2000</option><option value="Y2000_2010">2000–2010</option><option value="Y2010_2020">2010–2020</option><option value="CUSTOM">Custom range</option></select></label>
        {value.timeMode === 'CUSTOM' && <div className="playlist-builder__inline-fields"><label className="playlist-field"><span>From year</span><input type="number" value={value.customRange?.type === 'exact' ? value.customRange.startYear : ''} onChange={(event) => update('customRange', { type: 'exact', startYear: Number(event.target.value), endYear: value.customRange?.type === 'exact' ? value.customRange.endYear : Number(event.target.value) })} /></label><label className="playlist-field"><span>To year</span><input type="number" value={value.customRange?.type === 'exact' ? value.customRange.endYear : ''} onChange={(event) => update('customRange', { type: 'exact', startYear: value.customRange?.type === 'exact' ? value.customRange.startYear : Number(event.target.value), endYear: Number(event.target.value) })} /></label></div>}
      </fieldset>

      <fieldset className="playlist-builder__section"><legend>Season</legend><ChoiceGrid items={SEASONS} selected={value.seasons} onToggle={(item) => toggle('seasons', item)} /></fieldset>
      <fieldset className="playlist-builder__section"><legend>Genres</legend><label className="playlist-field"><span>Genre slugs (comma separated)</span><input value={value.genreSlugs.join(', ')} onChange={(event) => update('genreSlugs', splitValues(event.target.value))} placeholder="action, music" /></label><label className="playlist-check"><input type="checkbox" checked={value.genreMatchAll} onChange={(event) => update('genreMatchAll', event.target.checked)} /><span>Match every selected genre</span></label></fieldset>

      <fieldset className="playlist-builder__section"><legend>Rating</legend><div className="playlist-builder__inline-fields"><label className="playlist-field"><span>Minimum (0–10)</span><input type="number" min="0" max="10" step="0.5" value={value.minRating ?? ''} onChange={(event) => update('minRating', event.target.value === '' ? null : Number(event.target.value))} /></label><label className="playlist-field"><span>Rating source</span><select value={value.ratingSource} onChange={(event) => update('ratingSource', event.target.value as SimpleFilterState['ratingSource'])}><option value="MINE">My rating</option><option value="AVERAGE">Community average</option></select></label></div></fieldset>
      <fieldset className="playlist-builder__section"><legend>Media type</legend><ChoiceGrid items={SUBTYPES} selected={value.subtypes} onToggle={(item) => toggle('subtypes', item)} /></fieldset>
      <fieldset className="playlist-builder__section"><legend>Watching status</legend><ChoiceGrid items={STATUSES.map(([key, label]) => key)} labels={Object.fromEntries(STATUSES)} selected={value.watchingStatuses} onToggle={(item) => toggle('watchingStatuses', item)} /></fieldset>
      <fieldset className="playlist-builder__section"><legend>Theme type</legend><ChoiceGrid items={THEME_TYPES.map(([key]) => key)} labels={Object.fromEntries(THEME_TYPES)} selected={value.themeTypes} onToggle={(item) => toggle('themeTypes', item)} /></fieldset>
    </div>
  )
}

function ChoiceGrid({ items, selected, onToggle, labels = {} }: { items: string[]; selected: string[]; onToggle: (item: string) => void; labels?: Record<string, string> }) {
  return <div className="playlist-choice-grid">{items.map((item) => <label className="playlist-choice" key={item}><input type="checkbox" checked={selected.includes(item)} onChange={() => onToggle(item)} /><span>{labels[item] ?? item.replaceAll('_', ' ')}</span></label>)}</div>
}

interface AdvancedFilterBuilderProps {
  value: FilterNodeJson
  onChange: (value: FilterNodeJson) => void
}

function AdvancedFilterBuilder({ value, onChange }: AdvancedFilterBuilderProps) {
  const root = asGroup(value)
  const children = childNodes(root)
  const entries = children.map((node, index) => ({ node, index }))
  const includes = entries.filter(({ node }) => node.type !== 'not')
  const excludes = entries.filter(({ node }) => node.type === 'not')
  const replaceChild = (index: number, node: FilterNodeJson) => onChange(withChildren(root, children.map((child, childIndex) => childIndex === index ? node : child)))
  const removeChild = (index: number) => onChange(withChildren(root, children.filter((_, childIndex) => childIndex !== index)))
  const addInclude = () => onChange(withChildren(root, [...children, defaultRule('liked')]))
  const addExclude = () => onChange(withChildren(root, [...children, { type: 'not', child: defaultRule('disliked') }]))
  const changeRootOperator = (operator: 'and' | 'or') => onChange({ type: operator, children })

  return (
    <fieldset className="playlist-builder__section playlist-builder__advanced" aria-labelledby="advanced-filter-title">
      <legend id="advanced-filter-title">Advanced logic</legend>
      <p className="playlist-muted">Rules in Include must match. Rules in Exclude are wrapped in NOT. Groups can combine nested rules with AND or OR.</p>
      <label className="playlist-field playlist-builder__root-operator"><span>Top-level operator</span><select value={root.type} onChange={(event) => changeRootOperator(event.target.value as 'and' | 'or')}><option value="and">AND — all sections</option><option value="or">OR — any section</option></select></label>
      <div className="playlist-builder__rule-sections">
        <section className="playlist-rule-section" aria-labelledby="include-rules-title"><div className="playlist-rule-section__heading"><h4 id="include-rules-title">Include rules</h4><button type="button" className="playlist-button" onClick={addInclude}>+ Add rule</button></div>{includes.length === 0 && <p className="playlist-muted">Nothing included yet.</p>}{includes.map(({ node, index }) => <FilterTreeEditor key={`include-${index}`} node={node} path={[index]} onChange={(next) => replaceChild(index, next)} onRemove={() => removeChild(index)} />)}</section>
        <section className="playlist-rule-section" aria-labelledby="exclude-rules-title"><div className="playlist-rule-section__heading"><h4 id="exclude-rules-title">Exclude rules</h4><button type="button" className="playlist-button" onClick={addExclude}>+ Add rule</button></div>{excludes.length === 0 && <p className="playlist-muted">Nothing excluded yet.</p>}{excludes.map(({ node, index }) => <FilterTreeEditor key={`exclude-${index}`} node={node} path={[index]} onChange={(next) => replaceChild(index, next)} onRemove={() => removeChild(index)} isExcluded />)}</section>
      </div>
      <div className="playlist-builder__inline-actions"><button type="button" className="playlist-button" onClick={() => onChange(withChildren(root, [...children, { type: 'or', children: [defaultRule('liked')] }]))}>+ Add group</button></div>
      <p className="playlist-builder__filter-json" aria-live="polite">{validateFilterNode(value).length === 0 ? 'Advanced filter is ready to preview.' : validateFilterNode(value)[0]}</p>
    </fieldset>
  )
}

interface FilterTreeEditorProps {
  node: FilterNodeJson
  path: number[]
  onChange: (node: FilterNodeJson) => void
  onRemove: () => void
  isExcluded?: boolean
}

function FilterTreeEditor({ node, path, onChange, onRemove, isExcluded = false }: FilterTreeEditorProps) {
  if (node.type === 'not') {
    const child = isRecord(node.child) ? node.child as FilterNodeJson : defaultRule('liked')
    return <fieldset className="playlist-filter-node playlist-filter-node--exclude"><legend>NOT / excluded</legend><FilterTreeEditor node={child} path={[...path, 0]} onChange={(next) => onChange({ type: 'not', child: next })} onRemove={onRemove} isExcluded /></fieldset>
  }
  if (node.type === 'and' || node.type === 'or') {
    const children = childNodes(node)
    return <fieldset className="playlist-filter-node playlist-filter-node--group"><legend>{node.type.toUpperCase()} group</legend><div className="playlist-builder__inline-fields"><label className="playlist-field"><span>Group operator</span><select value={node.type} onChange={(event) => onChange({ type: event.target.value as 'and' | 'or', children })}><option value="and">AND</option><option value="or">OR</option></select></label><button type="button" className="playlist-button playlist-button--quiet" onClick={onRemove}>Remove group</button></div>{children.map((child, index) => <FilterTreeEditor key={`${path.join('-')}-${index}`} node={child} path={[...path, index]} onChange={(next) => onChange(withChildren(node, children.map((entry, childIndex) => childIndex === index ? next : entry)))} onRemove={() => onChange(withChildren(node, children.filter((_, childIndex) => childIndex !== index)))} />)}<div className="playlist-builder__inline-actions"><button type="button" className="playlist-button" onClick={() => onChange(withChildren(node, [...children, defaultRule('title_matches')]))}>+ Nested rule</button><button type="button" className="playlist-button" onClick={() => onChange(withChildren(node, [...children, { type: 'or', children: [defaultRule('liked')] }]))}>+ Nested group</button></div></fieldset>
  }
  return <RuleEditor node={node} onChange={onChange} onRemove={onRemove} isExcluded={isExcluded} />
}

function RuleEditor({ node, onChange, onRemove, isExcluded }: { node: FilterNodeJson; onChange: (node: FilterNodeJson) => void; onRemove: () => void; isExcluded: boolean }) {
  const changeType = (type: string) => onChange(defaultRule(type))
  return <fieldset className="playlist-filter-node playlist-filter-node--leaf"><legend>{isExcluded ? 'Exclude condition' : 'Include condition'}</legend><div className="playlist-builder__inline-fields"><label className="playlist-field"><span>Field</span><select aria-label="Rule field" value={node.type} onChange={(event) => changeType(event.target.value)}>{FIELD_OPTIONS.map((field) => <option value={field.type} key={field.type}>{field.label}</option>)}</select></label><button type="button" className="playlist-button playlist-button--quiet" onClick={onRemove}>Remove</button></div><RuleValueEditor node={node} onChange={onChange} /></fieldset>
}

function RuleValueEditor({ node, onChange }: { node: FilterNodeJson; onChange: (node: FilterNodeJson) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...node, [key]: value })
  if (['liked', 'disliked', 'downloaded'].includes(node.type)) return <p className="playlist-muted">This rule has no additional value.</p>
  if (node.type === 'genre_in') return <><label className="playlist-field"><span>Genre slugs</span><input value={stringValue(node.slugs).join(', ')} onChange={(event) => set('slugs', splitValues(event.target.value))} placeholder="action, music" /></label><label className="playlist-check"><input type="checkbox" checked={node.matchAll === true} onChange={(event) => set('matchAll', event.target.checked)} /><span>Match all genres</span></label></>
  if (node.type === 'season_in') return <ChoiceGrid items={SEASONS} selected={stringValue(node.seasons)} onToggle={(item) => set('seasons', toggleValue(stringValue(node.seasons), item))} />
  if (node.type === 'subtype_in') return <ChoiceGrid items={SUBTYPES} selected={stringValue(node.subtypes)} onToggle={(item) => set('subtypes', toggleValue(stringValue(node.subtypes), item))} />
  if (node.type === 'watching_status_in') return <ChoiceGrid items={STATUSES.map(([key]) => key)} labels={Object.fromEntries(STATUSES)} selected={stringValue(node.statuses)} onToggle={(item) => set('statuses', toggleValue(stringValue(node.statuses), item))} />
  if (node.type === 'theme_type_in') return <ChoiceGrid items={THEME_TYPES.map(([key]) => key)} labels={Object.fromEntries(THEME_TYPES)} selected={stringValue(node.types)} onToggle={(item) => set('types', toggleValue(stringValue(node.types), item))} />
  if (node.type === 'artist_in') return <label className="playlist-field"><span>Artist names</span><input value={stringValue(node.artistNames).join(', ')} onChange={(event) => set('artistNames', splitValues(event.target.value))} placeholder="Artist" /></label>
  if (node.type === 'title_matches' || node.type === 'song_title_matches') return <><label className="playlist-field"><span>{node.type === 'title_matches' ? 'Anime title contains' : 'Song title contains'}</span><input value={typeof node.pattern === 'string' ? node.pattern : ''} onChange={(event) => set('pattern', event.target.value)} /></label><label className="playlist-check"><input type="checkbox" checked={node.isRegex === true} onChange={(event) => set('isRegex', event.target.checked)} /><span>Use regular expression</span></label></>
  if (node.type === 'average_rating_gte' || node.type === 'user_rating_gte') return <label className="playlist-field"><span>Minimum rating (0–10)</span><input type="number" min="0" max="10" step="0.1" value={numberValue(node.min)} onChange={(event) => set('min', Number(event.target.value))} /></label>
  if (node.type === 'play_count_gte') return <label className="playlist-field"><span>Minimum plays</span><input type="number" min="0" step="1" value={numberValue(node.min)} onChange={(event) => set('min', Number(event.target.value))} /></label>
  if (node.type === 'aired_on' || node.type === 'watched_on' || node.type === 'played_on') return <DateRuleEditor node={node} onChange={onChange} />
  return null
}

function DateRuleEditor({ node, onChange }: { node: FilterNodeJson; onChange: (node: FilterNodeJson) => void }) {
  const anchor = isRecord(node.anchor) ? node.anchor : { type: 'absolute_year', year: new Date().getUTCFullYear() }
  const endAnchor = isRecord(node.endAnchor) ? node.endAnchor : { type: 'absolute_year', year: new Date().getUTCFullYear() }
  const updateAnchor = (key: 'anchor' | 'endAnchor', next: Record<string, unknown>) => onChange({ ...node, [key]: next })
  const anchorEditor = (label: string, key: 'anchor' | 'endAnchor', value: Record<string, unknown>) => <label className="playlist-field"><span>{label}</span><div className="playlist-builder__date-value"><select value={String(value.type)} onChange={(event) => updateAnchor(key, event.target.value === 'relative' ? { type: 'relative', unit: 'DAYS', amount: 30 } : { type: 'absolute_year', year: Number(value.year) || new Date().getUTCFullYear() })}><option value="absolute_year">Year</option><option value="relative">Relative</option></select>{value.type === 'relative' ? <><input type="number" min="0" value={numberValue(value.amount)} onChange={(event) => updateAnchor(key, { ...value, amount: Number(event.target.value) })} /><select value={String(value.unit)} onChange={(event) => updateAnchor(key, { ...value, unit: event.target.value })}><option value="DAYS">days ago</option><option value="MONTHS">months ago</option><option value="YEARS">years ago</option></select></> : <input type="number" min="1900" max="2200" value={numberValue(value.year)} onChange={(event) => updateAnchor(key, { ...value, year: Number(event.target.value) })} />}</div></label>
  return <div className="playlist-builder__date-rule"><label className="playlist-field"><span>Operator</span><select value={String(node.operator ?? 'GT')} onChange={(event) => onChange({ ...node, operator: event.target.value })}><option value="GT">After / since</option><option value="LT">Before</option><option value="BETWEEN">Between</option></select></label>{anchorEditor('Start value', 'anchor', anchor)}{node.operator === 'BETWEEN' && anchorEditor('End value', 'endAnchor', endAnchor)}</div>
}

interface SortBuilderProps { value: SortSpecJson; onChange: (value: SortSpecJson) => void; errors: string[] }

function SortBuilder({ value, onChange, errors }: SortBuilderProps) {
  const keys = value.keys
  const updateKey = (index: number, next: SortKeyJson) => onChange({ keys: keys.map((key, keyIndex) => keyIndex === index ? next : key) })
  const updateAttribute = (index: number, attribute: string) => {
    const current = keys[index]
    if (!current) return
    updateKey(index, {
      ...current,
      attribute,
      ...(isCategorical(attribute) ? { categoricalOrder: current.categoricalOrder?.length ? current.categoricalOrder : defaultCategoricalOrder(attribute) } : { categoricalOrder: undefined }),
    })
  }
  const move = (index: number, delta: -1 | 1) => { const target = index + delta; if (target < 0 || target >= keys.length) return; const next = [...keys]; const [key] = next.splice(index, 1); if (key) next.splice(target, 0, key); onChange({ keys: next }) }
  return <fieldset className="playlist-builder__section playlist-sort-builder"><legend>Sort order</legend><p className="playlist-muted">Earlier keys win ties. Add up to five keys, then reorder them by priority.</p>{keys.length === 0 && <p className="playlist-muted">Default catalog order will be used.</p>}{keys.map((key, index) => <div className="playlist-sort-key" key={`${key.attribute}-${index}`}><span className="playlist-sort-key__priority">{index + 1}</span><label className="playlist-field"><span>Sort field</span><select value={key.attribute} onChange={(event) => updateAttribute(index, event.target.value)}>{SORT_ATTRIBUTES.map(([attribute, label]) => <option value={attribute} key={attribute}>{label}</option>)}</select></label><label className="playlist-field"><span>Direction</span><select value={key.direction} onChange={(event) => updateKey(index, { ...key, direction: event.target.value as SortKeyJson['direction'] })}><option value="ASC">Ascending</option><option value="DESC">Descending</option></select></label>{isCategorical(key.attribute) && <label className="playlist-field"><span>Custom category order (optional)</span><input value={key.categoricalOrder?.join(', ') ?? ''} onChange={(event) => updateKey(index, { ...key, categoricalOrder: splitValues(event.target.value) })} placeholder="OP, ED, IN" /></label>}<div className="playlist-sort-key__actions"><button type="button" className="playlist-icon-button" aria-label={`Move sort key ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="playlist-icon-button" aria-label={`Move sort key ${index + 1} down`} disabled={index === keys.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" className="playlist-icon-button playlist-icon-button--danger" aria-label={`Remove sort key ${index + 1}`} onClick={() => onChange({ keys: keys.filter((_, keyIndex) => keyIndex !== index) })}>×</button></div></div>)}<button type="button" className="playlist-button" disabled={keys.length >= 5} onClick={() => onChange({ keys: [...keys, { attribute: 'TITLE', direction: 'ASC' }] })}>+ Add sort key</button>{errors.length > 0 && <p className="playlist-field__error" role="alert">{errors[0]}</p>}</fieldset>
}

function defaultRule(type: string): FilterNodeJson {
  switch (type) {
    case 'genre_in': return { type, slugs: ['action'], matchAll: false }
    case 'season_in': return { type, seasons: ['WINTER'] }
    case 'subtype_in': return { type, subtypes: ['tv'] }
    case 'watching_status_in': return { type, statuses: ['current'] }
    case 'theme_type_in': return { type, types: ['OP'] }
    case 'artist_in': return { type, artistNames: [''] }
    case 'title_matches': return { type, pattern: '', isRegex: false }
    case 'song_title_matches': return { type, pattern: '', isRegex: false }
    case 'average_rating_gte': return { type, min: 7 }
    case 'user_rating_gte': return { type, min: 7 }
    case 'play_count_gte': return { type, min: 1 }
    case 'aired_on': return dateRule(type)
    case 'watched_on': return dateRule(type)
    case 'played_on': return dateRule(type)
    default: return { type }
  }
}

function dateRule(type: string): FilterNodeJson { return { type, operator: 'GT', anchor: { type: 'absolute_year', year: new Date().getUTCFullYear() } } }
function asGroup(node: FilterNodeJson): FilterNodeJson { return node.type === 'and' || node.type === 'or' ? node : { type: 'and', children: [node] } }
function childNodes(node: FilterNodeJson): FilterNodeJson[] { return Array.isArray(node.children) ? node.children.filter(isRecord) as FilterNodeJson[] : [] }
function withChildren(node: FilterNodeJson, children: FilterNodeJson[]): FilterNodeJson { return { ...node, children } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function stringValue(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [] }
function splitValues(value: string): string[] { return value.split(',').map((entry) => entry.trim()).filter(Boolean) }
function toggleValue(values: string[], value: string): string[] { return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value] }
function numberValue(value: unknown): number | string { return typeof value === 'number' && Number.isFinite(value) ? value : '' }
function isCategorical(attribute: string): boolean { return ['THEME_TYPE', 'WATCHING_STATUS', 'SUBTYPE', 'SEASON'].includes(attribute) }
function defaultCategoricalOrder(attribute: string): string[] {
  if (attribute === 'THEME_TYPE') return ['OP', 'IN', 'ED']
  if (attribute === 'SEASON') return ['WINTER', 'SPRING', 'SUMMER', 'FALL']
  if (attribute === 'WATCHING_STATUS') return ['current', 'completed']
  if (attribute === 'SUBTYPE') return ['tv', 'movie', 'ova', 'ona', 'special', 'music']
  return []
}
