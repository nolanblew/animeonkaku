import { useMemo, useState } from 'react'
import type { LibraryAnimeDto, NormalizedLibrary } from '../../lib/library'
import { AnimeCard } from './AnimeCard'

export const DEFAULT_CATALOG_PAGE_SIZE = 24

export function AnimeGrid({
  anime,
  library,
  pageSize = DEFAULT_CATALOG_PAGE_SIZE,
}: {
  anime: readonly LibraryAnimeDto[]
  library?: NormalizedLibrary | null
  pageSize?: number
}) {
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const visible = useMemo(() => anime.slice(0, visibleCount), [anime, visibleCount])
  const themeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (!library) return counts
    for (const theme of Object.values(library.themesById)) {
      if (theme.deleted) continue
      for (const id of theme.kitsuAnimeIds) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [library])

  return (
    <>
      <div className="catalog-anime-grid">
        {visible.map((item) => <AnimeCard key={item.kitsuId} anime={item} themeCount={themeCounts.get(item.kitsuId)} />)}
      </div>
      {visibleCount < anime.length && (
        <button className="button button--secondary catalog-load-more" type="button" onClick={() => setVisibleCount((count) => Math.min(count + pageSize, anime.length))}>
          Load more anime <span>({anime.length - visibleCount} remaining)</span>
        </button>
      )}
    </>
  )
}
