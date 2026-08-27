import { ArrowUpRight, Play } from 'lucide-react'
import { Link } from 'react-router-dom'
import { displayTitle, statusLabel } from './selectors'
import type { CatalogAnime } from './types'
import { browserAssetUrl } from '../../lib/assets'
import { preferredAnimeTitle, useAnimeTitlePreference } from '../../lib/animeTitlePreference'

export function AnimeCard({ anime, themeCount }: { anime: CatalogAnime; themeCount?: number }) {
  const titlePreference = useAnimeTitlePreference()
  const title = preferredAnimeTitle(anime, titlePreference) || displayTitle(anime)
  return (
    <article className="catalog-anime-card" data-testid="anime-card">
      <Link className="catalog-anime-card__link" to={`/anime/${encodeURIComponent(anime.kitsuId)}`} aria-label={title}>
        <div className="catalog-anime-card__image">
          {anime.posterUrl ? <img src={browserAssetUrl(anime.posterUrl)} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">AO</span>}
          <span className="catalog-anime-card__overlay"><Play size={18} fill="currentColor" aria-hidden="true" /> Open anime</span>
        </div>
        <div className="catalog-anime-card__body">
          <h3>{title}</h3>
          <p>{[anime.subtype, anime.episodeCount ? `${anime.episodeCount} episodes` : null].filter(Boolean).join(' · ') || 'Anime'}</p>
          <div className="catalog-anime-card__meta"><span>{statusLabel(anime.watchingStatus)}</span>{themeCount !== undefined && <span>{themeCount} {themeCount === 1 ? 'theme' : 'themes'}</span>}<ArrowUpRight size={15} aria-hidden="true" /></div>
        </div>
      </Link>
    </article>
  )
}
