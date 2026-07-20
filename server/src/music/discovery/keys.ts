export const musicCatalogScanDedupeKey = () => "MUSIC_CATALOG_SCAN";
export const discoverAnimeMusicDedupeKey = (animeId: number) => `DISCOVER_ANIME_MUSIC:${animeId}`;
export const reconcileMusicAcquisitionDedupeKey = (acquisitionId: number) =>
  `RECONCILE_MUSIC_ACQUISITION:${acquisitionId}`;
