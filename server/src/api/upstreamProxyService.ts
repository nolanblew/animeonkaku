import type { AnimeThemesClient } from "../animethemes/client.js";
import type { KitsuClient } from "../kitsu/kitsuClient.js";
import type { ProxyUpstream } from "./proxyRoutes.js";

export class UpstreamProxyService implements ProxyUpstream {
  constructor(
    private readonly animeThemes: Pick<AnimeThemesClient, "search" | "fetchArtist">,
    private readonly kitsu: Pick<KitsuClient, "searchAnimeByText">,
  ) {}

  async search(query: string): Promise<unknown> {
    const [animeThemes, kitsu] = await Promise.all([
      this.animeThemes.search(query),
      this.kitsu.searchAnimeByText(query),
    ]);
    return { query, animeThemes, kitsu };
  }

  async artist(slug: string): Promise<unknown> {
    return this.animeThemes.fetchArtist(slug);
  }
}
