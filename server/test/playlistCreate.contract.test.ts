import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Guards for the playlist-create failure chain seen in production (07/2026):
 * a device replayed a smart-playlist create whose entries referenced themes this
 * server never cataloged → playlist_entries FK violation → 500; the non-
 * transactional insert left an orphaned playlist row, so every retry then died
 * on the (user_id, name) active unique index. Verified end-to-end against a
 * local Postgres with the captured device payload.
 */
describe("playlist create contract", () => {
  it("filters entries to cataloged themes, creates transactionally, and converges retried creates", async () => {
    const service = await readFile(
      new URL("../src/api/drizzleClientApiService.ts", import.meta.url),
      "utf8",
    );

    // Unknown theme ids must be dropped (and logged), not FK-crash the write.
    expect(service).toContain("knownThemeIds(entries");
    expect(service).toContain("dropping playlist entries for theme ids unknown to this server");

    // Create is atomic: a failed entries insert cannot orphan the playlist row.
    expect(service).toMatch(/createPlaylist[\s\S]*?this\.db\.transaction/);

    // A replayed create converges on the existing active row instead of
    // violating playlists_user_id_name_active_unique.
    expect(service).toContain("activePlaylistByName(userId, input.name)");
  });
});
