import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ADVANCED_FILTER,
  DEFAULT_SORT_SPEC,
  buildAdvancedFilter,
  buildPlaylistUpdate,
  compileSimpleFilter,
  createDefaultSimpleFilter,
  deserializeDynamicSpec,
  deserializeSortSpec,
  serializeDynamicSpec,
  serializeSortSpec,
  validateFilterNode,
  validateSortSpec,
  type FilterNodeJson,
  type PlaylistEditorValues,
  type SimpleFilterState,
  type SortSpecJson,
} from './model'

const baseValues: PlaylistEditorValues = {
  name: 'Smart mix',
  defaultMode: 'TV_SIZE',
  overrideUserPreference: false,
  autoUpdate: true,
  dynamicSpecJson: '',
  dynamicSortJson: '',
  isDynamic: true,
}

const leaf: FilterNodeJson = { type: 'liked' }

describe('dynamic playlist builder model', () => {
  it('round-trips the mobile/server dynamic envelope and preserves nested groups', () => {
    const filter: FilterNodeJson = {
      type: 'and',
      children: [
        { type: 'genre_in', slugs: ['action', 'music'], matchAll: true },
        { type: 'not', child: { type: 'or', children: [leaf, { type: 'downloaded' }] } },
      ],
    }
    const sort: SortSpecJson = {
      keys: [
        { attribute: 'WATCHED_DATE', direction: 'DESC' },
        { attribute: 'TITLE', direction: 'ASC' },
      ],
    }
    const serialized = serializeDynamicSpec({ filter, mode: 'AUTO', createdMode: 'ADVANCED', sort })
    expect(serialized).toMatchObject({ filterJson: filter, mode: 'AUTO', createdMode: 'ADVANCED', schemaVersion: 1, sortJson: sort })
    expect(deserializeDynamicSpec(serialized)).toMatchObject({ filter, mode: 'AUTO', createdMode: 'ADVANCED', sort })
    expect(deserializeDynamicSpec(JSON.stringify(serialized)).filter).toEqual(filter)
  })

  it('compiles mobile simple sections into server-compatible rules', () => {
    const state: SimpleFilterState = {
      ...createDefaultSimpleFilter(),
      timeDimension: 'AIRED',
      timeMode: 'Y2000_2010',
      seasons: ['WINTER'],
      genreSlugs: ['action', 'music'],
      genreMatchAll: true,
      minRating: 8.5,
      ratingSource: 'AVERAGE',
      subtypes: ['tv'],
      watchingStatuses: ['current'],
      themeTypes: ['OP'],
    }
    expect(compileSimpleFilter(state)).toEqual({
      type: 'and',
      children: [
        { type: 'aired_on', operator: 'BETWEEN', anchor: { type: 'absolute_year', year: 2000 }, endAnchor: { type: 'absolute_year', year: 2010 } },
        { type: 'season_in', seasons: ['WINTER'] },
        { type: 'genre_in', slugs: ['action', 'music'], matchAll: true },
        { type: 'average_rating_gte', min: 8.5 },
        { type: 'subtype_in', subtypes: ['tv'] },
        { type: 'watching_status_in', statuses: ['current'] },
        { type: 'theme_type_in', types: ['OP'] },
      ],
    })
  })

  it('builds include/exclude roots without losing nested advanced groups', () => {
    const nested: FilterNodeJson = { type: 'or', children: [{ type: 'title_matches', pattern: 'cowboy', isRegex: false }, leaf] }
    expect(buildAdvancedFilter([nested, leaf], [{ type: 'downloaded' }])).toEqual({
      type: 'and',
      children: [nested, leaf, { type: 'not', child: { type: 'downloaded' } }],
    })
    expect(buildAdvancedFilter([], [])).toEqual(DEFAULT_ADVANCED_FILTER)
  })

  it('validates empty groups, malformed values, and sort key limits', () => {
    expect(validateFilterNode({ type: 'and', children: [] })[0]).toMatch(/Add at least one rule/)
    expect(validateFilterNode(compileSimpleFilter(createDefaultSimpleFilter()), true, true)).toEqual([])
    expect(validateFilterNode({ type: 'user_rating_gte', min: 0 })).toEqual([])
    expect(validateFilterNode({ type: 'and', children: [{ type: 'title_matches', pattern: '' }] })[0]).toMatch(/Title pattern cannot be empty/)
    expect(validateFilterNode({ type: 'or', children: [leaf, { type: 'and', children: [] }] })[0]).toMatch(/Remove or fill empty groups/)
    expect(validateSortSpec({ keys: [{ attribute: 'UNKNOWN', direction: 'SIDEWAYS' } as never] })[0]).toMatch(/Sort key 1 has an unsupported attribute/)
  })

  it('serializes sort order and uses AUTO/SNAPSHOT semantics when saving', () => {
    const sort = { keys: [{ attribute: 'THEME_TYPE', direction: 'ASC', categoricalOrder: ['OP', 'ED', 'IN'] }] } satisfies SortSpecJson
    expect(deserializeSortSpec(JSON.stringify(serializeSortSpec(sort)))).toEqual(sort)

    const auto = buildPlaylistUpdate({
      ...baseValues,
      dynamicMode: 'AUTO',
      createdMode: 'ADVANCED',
      advancedFilter: leaf,
      sortSpec: sort,
    }, [{ key: 'entry:1', entryId: 1, itemType: 'THEME', itemId: 8, modeOverride: null }])
    expect(auto.dynamicSpecJson).toMatchObject({ filterJson: leaf, mode: 'AUTO', createdMode: 'ADVANCED' })
    expect(auto.dynamicSortJson).toEqual(sort)
    expect(auto.items).toBeUndefined()

    const snapshot = buildPlaylistUpdate({
      ...baseValues,
      autoUpdate: false,
      dynamicMode: 'SNAPSHOT',
      createdMode: 'SIMPLE',
      simpleFilter: createDefaultSimpleFilter(),
      sortSpec: DEFAULT_SORT_SPEC,
    }, [{ key: 'entry:1', entryId: 1, itemType: 'THEME', itemId: 8, modeOverride: null }])
    expect(snapshot.dynamicSpecJson).toMatchObject({ mode: 'SNAPSHOT', createdMode: 'SIMPLE' })
    expect(snapshot.items).toEqual([{ entryId: 1, itemType: 'THEME', itemId: 8, modeOverride: null }])
  })
})
