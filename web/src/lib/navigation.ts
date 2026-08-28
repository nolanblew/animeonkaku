/** Matches the server's artist slug generation for stable artist routes. */
export function artistRouteSlug(value: string | null | undefined): string | undefined {
  const name = (value ?? '').trim()
  if (!name || /^various artists?$/iu.test(name)) return undefined
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return slug || undefined
}
