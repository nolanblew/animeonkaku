import type { LibraryAnimeDto } from '../../lib/library'
import { preferredAnimeTitle } from '../../lib/animeTitlePreference'

export type LibrarySort = 'recent' | 'title-asc' | 'title-desc'

export function filterAndSortAnime(
  anime: readonly LibraryAnimeDto[],
  query: string,
  status: string,
  sort: LibrarySort,
): LibraryAnimeDto[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const result = anime.filter((item) => {
    if (status !== 'all' && (item.watchingStatus ?? '').toLocaleLowerCase() !== status) return false
    if (!normalizedQuery) return true
    const searchable = [item.title, item.titleEn, item.titleRomaji, item.titleJa, item.slug, ...item.genres]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
    return searchable.includes(normalizedQuery)
  })

  return result.sort((left, right) => {
    if (sort === 'title-asc' || sort === 'title-desc') {
      const comparison = displayTitle(left).localeCompare(displayTitle(right), undefined, { sensitivity: 'base' })
      return sort === 'title-asc' ? comparison : -comparison
    }
    return right.updatedAt - left.updatedAt || displayTitle(left).localeCompare(displayTitle(right))
  })
}

export function displayTitle(anime: Pick<LibraryAnimeDto, 'title' | 'titleEn' | 'titleRomaji' | 'titleJa'>): string {
  return preferredAnimeTitle(anime) || 'Untitled anime'
}

export function statusLabel(status: string | null): string {
  if (!status) return 'Saved'
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
