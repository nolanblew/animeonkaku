export const musicCatalogScanDedupeKey = () => "MUSIC_CATALOG_SCAN";
export const discoverAnimeMusicDedupeKey = (animeId: number) => `DISCOVER_ANIME_MUSIC:${animeId}`;
export const reconcileMusicAcquisitionDedupeKey = (acquisitionId: number) =>
  `RECONCILE_MUSIC_ACQUISITION:${acquisitionId}`;
export const importMusicAudioDedupeKey = (acquisitionId: number) =>
  `IMPORT_MUSIC_AUDIO:${acquisitionId}`;
