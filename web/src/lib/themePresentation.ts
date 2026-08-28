export interface ThemePresentationInput {
  animeTitle?: string | null
  themeType?: string | null
  songTitle?: string | null
  artist?: string | null
}

export interface ThemePresentation {
  primary: string
  secondary: string
  typeLabel: string | null
}

export function formatThemeType(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  const compact = normalized.replace(/[\s_-]+/g, '').toUpperCase()
  const match = /^(OP|OPENING|ED|ENDING)(\d+)?$/.exec(compact)
  if (!match) return normalized
  const kind = match[1] === 'OP' || match[1] === 'OPENING' ? 'OP' : 'ED'
  return match[2] ? `${kind} ${Number(match[2])}` : kind
}

export function themePresentation(input: ThemePresentationInput): ThemePresentation {
  const animeTitle = clean(input.animeTitle)
  const songTitle = clean(input.songTitle) || 'Untitled theme'
  const artist = clean(input.artist)
  const typeLabel = formatThemeType(input.themeType)
  const primary = animeTitle && typeLabel
    ? `${animeTitle} · ${typeLabel}`
    : animeTitle || (typeLabel ? `${typeLabel} · ${songTitle}` : songTitle)
  return {
    primary,
    secondary: artist ? `${songTitle} · ${artist}` : songTitle,
    typeLabel,
  }
}

export function compareThemeTypes(left: string | null | undefined, right: string | null | undefined): number {
  const a = themeSortKey(left)
  const b = themeSortKey(right)
  return a.group - b.group || a.number - b.number || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
}

export function compareThemesByType<T extends { themeType?: string | null; id?: number; title?: string | null }>(left: T, right: T): number {
  return compareThemeTypes(left.themeType, right.themeType)
    || (left.id ?? 0) - (right.id ?? 0)
    || clean(left.title).localeCompare(clean(right.title), undefined, { numeric: true, sensitivity: 'base' })
}

function themeSortKey(value: string | null | undefined) {
  const label = formatThemeType(value) ?? ''
  const match = /^(OP|ED)(?:\s+(\d+))?$/.exec(label)
  if (!match) return { group: 2, number: Number.MAX_SAFE_INTEGER, label }
  return { group: match[1] === 'OP' ? 0 : 1, number: match[2] ? Number(match[2]) : 0, label }
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? ''
}
