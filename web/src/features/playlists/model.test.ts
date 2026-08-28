import { describe, expect, it } from 'vitest'
import {
  buildPlaylistUpdate,
  normalizePlaylistItems,
  parseJsonEditorValue,
  reorderPlaylistItems,
  validatePlaylistForm,
  type PlaylistEditorValues,
} from './model'

const baseValues: PlaylistEditorValues = {
  name: '  Evening themes  ',
  defaultMode: 'FULL_SIZE',
  overrideUserPreference: true,
  autoUpdate: false,
  dynamicSpecJson: '',
  dynamicSortJson: '',
}

describe('playlist model', () => {
  it('normalizes legacy entries without losing occurrence identity', () => {
    const items = normalizePlaylistItems({
      id: 4,
      name: 'Mix',
      entries: [8, 8],
      items: [],
      defaultMode: 'TV_SIZE',
      overrideUserPreference: false,
      isAuto: false,
      isDynamic: false,
      autoUpdate: false,
      updatedAt: 1,
      deleted: false,
      dynamicSpecJson: null,
      dynamicSortJson: null,
    })

    expect(items).toHaveLength(2)
    expect(items[0]?.key).not.toBe(items[1]?.key)
    expect(items.map((item) => item.itemId)).toEqual([8, 8])
  })

  it('reorders by stable key and does not mutate source entries', () => {
    const items = normalizePlaylistItems({
      id: 4,
      name: 'Mix',
      entries: [],
      items: [
        { entryId: 101, itemType: 'THEME', itemId: 8, modeOverride: null },
        { entryId: 102, itemType: 'THEME', itemId: 9, modeOverride: 'FULL_SIZE' },
      ],
      defaultMode: 'TV_SIZE',
      overrideUserPreference: false,
      isAuto: false,
      isDynamic: false,
      autoUpdate: false,
      updatedAt: 1,
      deleted: false,
      dynamicSpecJson: null,
      dynamicSortJson: null,
    })
    const reordered = reorderPlaylistItems(items, 'entry:102', -1)
    expect(reordered.map((item) => item.itemId)).toEqual([9, 8])
    expect(items.map((item) => item.itemId)).toEqual([8, 9])
  })

  it('rejects unsafe or malformed form values and accepts bounded JSON', () => {
    expect(validatePlaylistForm({ ...baseValues, name: ' ' })).toEqual({ name: 'Give your playlist a name.' })
    expect(validatePlaylistForm({ ...baseValues, name: '<script>alert(1)</script>' })).toEqual({ name: 'Playlist name contains unsupported markup.' })
    expect(parseJsonEditorValue('{"type":"liked"}', 'Filter')).toEqual({ type: 'liked' })
    expect(() => parseJsonEditorValue('{broken', 'Filter')).toThrow('Filter must be valid JSON.')
    expect(() => parseJsonEditorValue('null', 'Filter')).toThrow('Filter must be a JSON object or array.')
    expect(() => parseJsonEditorValue('x'.repeat(17_000), 'Filter')).toThrow('Filter is too large.')
  })

  it('builds a safe manual update with stable item occurrences', () => {
    const items = [
      { key: 'entry:101', entryId: 101, itemType: 'THEME' as const, itemId: 8, modeOverride: null },
      { key: 'local:1', entryId: null, itemType: 'SONG' as const, itemId: 22, modeOverride: null },
    ]
    expect(buildPlaylistUpdate(baseValues, items)).toEqual({
      name: 'Evening themes',
      defaultMode: 'FULL_SIZE',
      overrideUserPreference: true,
      autoUpdate: false,
      items: [
        { entryId: 101, itemType: 'THEME', itemId: 8, modeOverride: null },
        { itemType: 'SONG', itemId: 22, modeOverride: null },
      ],
    })
  })
})
