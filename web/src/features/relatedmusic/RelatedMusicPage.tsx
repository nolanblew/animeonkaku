import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Disc3, ExternalLink, Music2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { browserAssetUrl } from '../../lib/assets'
import type { AnimeMusicDto, MusicReleaseDto } from '../../lib/library'
import { CatalogError, CatalogLoading } from '../catalog/CatalogError'
import './relatedmusic.css'

type RequestScope = 'FULL_SONGS' | 'EXTRA_MUSIC'

interface RequestScopeStatus {
  scope: RequestScope
  active: boolean
  eligibleCount: number
  availableCount: number
  missingCount: number
  latest: { id: string; state: string; active: boolean; scope: RequestScope; lastUpdatedAt: string } | null
}

export interface MusicRequestStatusResponse {
  kitsuId: string
  scopes: RequestScopeStatus[]
}

interface MusicRequestResponse {
  request: { id: string; scope: RequestScope; state: string; active: boolean; lastUpdatedAt: string }
  replayed: boolean
}

export interface RelatedMusicPageProps {
  onOpenRelease?: (release: MusicReleaseDto) => void
}

export function RelatedMusicPage({ onOpenRelease }: RelatedMusicPageProps = {}) {
  const params = useParams<{ kitsuId?: string; animeId?: string }>()
  const kitsuId = params.kitsuId ?? params.animeId
  const [submitting, setSubmitting] = useState<RequestScope | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const music = useQuery<AnimeMusicDto>({
    queryKey: ['related-music', kitsuId],
    enabled: Boolean(kitsuId),
    queryFn: ({ signal }) => apiClient.get<AnimeMusicDto>(`/v1/anime/${encodeURIComponent(kitsuId!)}/music`, { signal }),
    staleTime: 60_000,
  })
  const requestStatus = useQuery<MusicRequestStatusResponse>({
    queryKey: ['music-request-status', kitsuId],
    enabled: Boolean(kitsuId),
    queryFn: ({ signal }) => apiClient.get<MusicRequestStatusResponse>(`/v1/anime/${encodeURIComponent(kitsuId!)}/music-requests/status`, { signal }),
    staleTime: 15_000,
  })

  if (!kitsuId) return <CatalogError title="Related music unavailable" message="This anime link is not valid." />
  if (music.isError) return <CatalogError title="Related music unavailable" message="Could not load related music. Try again in a moment." error={music.error} onRetry={() => void music.refetch()} />
  if (music.isPending || !music.data) return <CatalogLoading label="Loading related music" />

  const releases = Array.isArray(music.data.releases) ? music.data.releases : []
  const fullSongs = scopeStatus(requestStatus.data, 'FULL_SONGS')
  const extraMusic = scopeStatus(requestStatus.data, 'EXTRA_MUSIC')
  const title = music.data.anime.title || music.data.anime.titleEn || 'this anime'

  async function submit(scope: RequestScope) {
    if (!kitsuId || submitting || !canRequest(scope === 'FULL_SONGS' ? fullSongs : extraMusic)) return
    setSubmitting(scope)
    setNotice(null)
    setSubmitError(null)
    try {
      await apiClient.post<MusicRequestResponse>(`/v1/anime/${encodeURIComponent(kitsuId)}/music-requests/${scope === 'FULL_SONGS' ? 'full-songs' : 'extra-music'}`)
      setNotice(`${scope === 'FULL_SONGS' ? 'Full-song' : 'Extra music'} request queued.`)
      void requestStatus.refetch()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not submit the music request.')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <section className="page related-music-page" aria-labelledby="related-music-title">
      <Link className="catalog-back-link" to={`/anime/${encodeURIComponent(kitsuId)}`}><ArrowLeft size={16} /> Back to anime</Link>
      <header className="related-music-page__header">
        <div><p className="eyebrow">Music discovery</p><h1 id="related-music-title">Related Music</h1><p>Albums and soundtracks connected to <Link to={`/anime/${encodeURIComponent(kitsuId)}`}>{title}</Link>.</p></div>
        <Music2 size={42} aria-hidden="true" />
      </header>

      <RequestPanel fullSongs={fullSongs} extraMusic={extraMusic} submitting={submitting} notice={notice} error={submitError} statusPending={requestStatus.isPending} statusError={requestStatus.isError} onSubmit={submit} onRetry={() => void requestStatus.refetch()} />

      <section className="related-music-page__section" aria-labelledby="related-music-releases-title">
        <div className="related-music-page__section-heading"><div><p className="eyebrow">Albums and soundtracks</p><h2 id="related-music-releases-title">Releases</h2></div><span>{releases.length}</span></div>
        {releases.length === 0 ? <p className="catalog-empty">No ready related releases are available for this anime yet.</p> : <div className="related-music-page__grid">{releases.map((release) => <ReleaseCard key={release.id} release={release} onOpen={onOpenRelease} />)}</div>}
      </section>
    </section>
  )
}

function RequestPanel({ fullSongs, extraMusic, submitting, notice, error, statusPending, statusError, onSubmit, onRetry }: { fullSongs: RequestScopeStatus | null; extraMusic: RequestScopeStatus | null; submitting: RequestScope | null; notice: string | null; error: string | null; statusPending: boolean; statusError: boolean; onSubmit: (scope: RequestScope) => void; onRetry: () => void }) {
  return <section className="related-music-page__requests" aria-labelledby="music-request-title"><div><p className="eyebrow">Catalog requests</p><h2 id="music-request-title">Missing music</h2><p className="related-music-page__request-copy">Request provider searches for music that is not ready yet.</p></div><div className="related-music-page__request-actions"><RequestButton scope="FULL_SONGS" status={fullSongs} submitting={submitting} onSubmit={onSubmit} /><RequestButton scope="EXTRA_MUSIC" status={extraMusic} submitting={submitting} onSubmit={onSubmit} /></div>{statusPending && <span className="related-music-page__request-state">Checking request status…</span>}{statusError && <span className="related-music-page__request-error">Could not load request status. <button type="button" onClick={onRetry}>Try again</button></span>}{notice && <span className="related-music-page__request-success" role="status">{notice}</span>}{error && <span className="related-music-page__request-error" role="alert">{error}</span>}</section>
}

function RequestButton({ scope, status, submitting, onSubmit }: { scope: RequestScope; status: RequestScopeStatus | null; submitting: RequestScope | null; onSubmit: (scope: RequestScope) => void }) {
  const label = scope === 'FULL_SONGS' ? 'Request Full Songs' : 'Request Extra Music'
  const count = status?.missingCount ?? 0
  const active = status?.active ?? false
  return <button className="button button--secondary related-music-page__request-button" type="button" aria-label={label} disabled={!status || count <= 0 || active || submitting !== null} onClick={() => onSubmit(scope)}>{submitting === scope ? 'Submitting…' : label}<small>{status ? active ? 'In progress' : `${count} missing ${scope === 'FULL_SONGS' ? 'full songs' : 'extra music'}` : 'Status unavailable'}</small></button>
}

function ReleaseCard({ release, onOpen }: { release: MusicReleaseDto; onOpen?: (release: MusicReleaseDto) => void }) {
  const artworkUrl = browserAssetUrl(release.artworkUrl)
  return <article className="related-music-page__card">{artworkUrl ? <img src={artworkUrl} alt={`${release.title} artwork`} loading="lazy" /> : <span className="related-music-page__card-art" aria-hidden="true"><Disc3 size={28} /></span>}<div className="related-music-page__card-copy"><p className="eyebrow">{release.relationshipType || 'Release'}</p><h3><Link to={`/release/${release.id}`} onClick={() => onOpen?.(release)}>{release.title}</Link></h3><p>{release.artistCredit || 'Various artists'}</p><small>{release.tracks.length} {release.tracks.length === 1 ? 'track' : 'tracks'}{release.year ? ` · ${release.year}` : ''}</small><Link className="related-music-page__open" to={`/release/${release.id}`} onClick={() => onOpen?.(release)}>Open release <ExternalLink size={13} /></Link></div></article>
}

function scopeStatus(status: MusicRequestStatusResponse | undefined, scope: RequestScope): RequestScopeStatus | null {
  return status?.scopes?.find((entry) => entry.scope === scope) ?? null
}

function canRequest(status: RequestScopeStatus | null): boolean {
  return Boolean(status && !status.active && status.missingCount > 0)
}
