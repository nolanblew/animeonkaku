import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { DynamicPlaylistBuilder } from './dynamicBuilder'
import {
  createDefaultSimpleFilter,
  DEFAULT_SORT_SPEC,
  type DynamicCreatedMode,
  type DynamicPlaylistMode,
  type FilterNodeJson,
  type SimpleFilterState,
  type SortSpecJson,
} from './model'

function BuilderHarness({ initialMode = 'SIMPLE', initialFilter }: { initialMode?: DynamicCreatedMode; initialFilter?: FilterNodeJson }) {
  const [createdMode, setCreatedMode] = useState<DynamicCreatedMode>(initialMode)
  const [dynamicMode, setDynamicMode] = useState<DynamicPlaylistMode>('AUTO')
  const [simpleFilter, setSimpleFilter] = useState<SimpleFilterState>(createDefaultSimpleFilter())
  const [advancedFilter, setAdvancedFilter] = useState<FilterNodeJson>(initialFilter ?? { type: 'and', children: [] })
  const [sortSpec, setSortSpec] = useState<SortSpecJson>(DEFAULT_SORT_SPEC)
  return <DynamicPlaylistBuilder createdMode={createdMode} dynamicMode={dynamicMode} simpleFilter={simpleFilter} advancedFilter={advancedFilter} sortSpec={sortSpec} onCreatedModeChange={setCreatedMode} onDynamicModeChange={setDynamicMode} onSimpleFilterChange={setSimpleFilter} onAdvancedFilterChange={setAdvancedFilter} onSortSpecChange={setSortSpec} />
}

describe('structured dynamic playlist builder', () => {
  it('edits every simple filter section and the prioritized sort list', () => {
    render(<BuilderHarness />)

    fireEvent.click(screen.getByRole('radio', { name: 'Watched' }))
    fireEvent.change(screen.getByLabelText('Time range'), { target: { value: 'CUSTOM' } })
    fireEvent.change(screen.getByLabelText('From year'), { target: { value: '2012' } })
    fireEvent.change(screen.getByLabelText('To year'), { target: { value: '2024' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'WINTER' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'WINTER' }))
    fireEvent.change(screen.getByLabelText('Genre slugs (comma separated)'), { target: { value: 'action, music' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /match every selected genre/i }))
    fireEvent.change(screen.getByLabelText('Minimum (0–10)'), { target: { value: '8.5' } })
    fireEvent.change(screen.getByLabelText('Rating source'), { target: { value: 'AVERAGE' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'movie' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Completed' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ending' }))

    fireEvent.change(screen.getAllByLabelText('Sort field')[0], { target: { value: 'THEME_TYPE' } })
    fireEvent.change(screen.getByLabelText('Custom category order (optional)'), { target: { value: 'OP, IN, ED' } })
    fireEvent.change(screen.getAllByLabelText('Direction')[0], { target: { value: 'ASC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move sort key 2 up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove sort key 2' }))
    fireEvent.click(screen.getByRole('button', { name: /add sort key/i }))

    expect(screen.getByRole('status')).toHaveTextContent('Valid filter')
    expect(screen.getAllByLabelText('Sort field')).toHaveLength(2)
  })

  it('builds, changes, nests, and removes advanced include and exclude rules', () => {
    render(<BuilderHarness initialMode="ADVANCED" initialFilter={{
      type: 'and',
      children: [
        { type: 'liked' },
        { type: 'not', child: { type: 'disliked' } },
        { type: 'or', children: [{ type: 'title_matches', pattern: 'hero', isRegex: false }] },
      ],
    }} />)

    fireEvent.change(screen.getByLabelText('Top-level operator'), { target: { value: 'or' } })
    const include = screen.getByRole('heading', { name: 'Include rules' }).closest('section')!
    const exclude = screen.getByRole('heading', { name: 'Exclude rules' }).closest('section')!
    fireEvent.click(within(include).getByRole('button', { name: /add rule/i }))
    fireEvent.click(within(exclude).getByRole('button', { name: /add rule/i }))
    fireEvent.click(screen.getByRole('button', { name: /add group/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /nested rule/i })[0])
    fireEvent.click(screen.getAllByRole('button', { name: /nested group/i })[0])

    const fields = screen.getAllByLabelText('Rule field')
    fireEvent.change(fields[0], { target: { value: 'genre_in' } })
    fireEvent.change(screen.getByLabelText('Genre slugs'), { target: { value: 'drama, music' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /match all genres/i }))
    fireEvent.change(screen.getAllByLabelText('Rule field')[0], { target: { value: 'season_in' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'SPRING' }))
    fireEvent.change(screen.getAllByLabelText('Rule field')[0], { target: { value: 'artist_in' } })
    fireEvent.change(screen.getByLabelText('Artist names'), { target: { value: 'Aimer, LiSA' } })
    fireEvent.change(screen.getAllByLabelText('Rule field')[0], { target: { value: 'song_title_matches' } })
    fireEvent.change(screen.getByLabelText('Song title contains'), { target: { value: 'again' } })
    fireEvent.click(screen.getAllByRole('checkbox', { name: /regular expression/i })[0])
    fireEvent.change(screen.getAllByLabelText('Rule field')[0], { target: { value: 'play_count_gte' } })
    fireEvent.change(screen.getByLabelText('Minimum plays'), { target: { value: '3' } })
    fireEvent.change(screen.getAllByLabelText('Rule field')[0], { target: { value: 'aired_on' } })
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'BETWEEN' } })
    const start = screen.getByText('Start value').closest('label')!
    fireEvent.change(within(start).getByRole('combobox'), { target: { value: 'relative' } })
    fireEvent.change(within(start).getByRole('spinbutton'), { target: { value: '6' } })
    fireEvent.change(within(start).getAllByRole('combobox')[1], { target: { value: 'MONTHS' } })
    const end = screen.getByText('End value').closest('label')!
    fireEvent.change(within(end).getByRole('spinbutton'), { target: { value: '2025' } })

    fireEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[0])
    fireEvent.click(screen.getByRole('radio', { name: /snapshot these tracks/i }))
    expect(screen.getByText(/fixed snapshot/i)).toBeInTheDocument()
  })
})
