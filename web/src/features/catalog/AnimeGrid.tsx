import { useEffect, useMemo, useState } from 'react'
import type { LibraryAnimeDto, NormalizedLibrary } from '../../lib/library'
import { AnimeCard } from './AnimeCard'

export const DEFAULT_CATALOG_PAGE_SIZE = 24

export function AnimeGrid({
  anime,
  library,
  pageSize = DEFAULT_CATALOG_PAGE_SIZE,
  onPlayAnime,
}: {
  anime: readonly LibraryAnimeDto[]
  library?: NormalizedLibrary | null
  pageSize?: number
  onPlayAnime?: (anime: LibraryAnimeDto) => void
}) {
  const boundedPageSize = Math.max(1, pageSize)
  const pageCount = Math.max(1, Math.ceil(anime.length / boundedPageSize))
  const [page, setPage] = useState(0)
  useEffect(() => setPage((current) => Math.min(current, pageCount - 1)), [pageCount])
  const visible = useMemo(() => {
    const start = page * boundedPageSize
    return anime.slice(start, start + boundedPageSize)
  }, [anime, boundedPageSize, page])
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
        {visible.map((item) => <AnimeCard key={item.kitsuId} anime={item} themeCount={themeCounts.get(item.kitsuId)} onPlayAnime={onPlayAnime} />)}
      </div>
      {pageCount > 1 && <nav className="catalog-pagination" aria-label="Anime pages">
        <button className="button button--secondary" type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous page</button>
        <span aria-live="polite">Page {page + 1} of {pageCount}</span>
        <button className="button button--secondary" type="button" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next anime page</button>
      </nav>}
    </>
  )
}
