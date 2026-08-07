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

    // Concurrent same-name creates converge at the unique index as well as the
    // optimistic preflight, instead of one racing request leaking a 500.
    expect(service).toMatch(/insert\(playlists\)[\s\S]*?onConflictDoNothing\(\)/);

    // A replayed create converges on the existing active row instead of
    // violating playlists_user_id_name_active_unique.
    expect(service).toContain("activePlaylistByName(userId, input.name)");
  });

  it("materializes auto-update dynamic playlists server-side, ignoring client entries", async () => {
    const service = await readFile(
      new URL("../src/api/drizzleClientApiService.ts", import.meta.url),
      "utf8",
    );

    // Create: spec is evaluated on the server for dynamic+autoUpdate playlists.
    expect(service).toMatch(/serverEvaluated[\s\S]*?dynamicPlaylistEvaluator\.refresh\(userId, playlistId\)/);
    // Update: same authority flip after a spec/autoUpdate change.
    expect(service).toMatch(/serverEvaluated = state\?\.isDynamic === true && state\.autoUpdate[\s\S]*?dynamicPlaylistEvaluator\.refresh\(userId, id\)/);
    // Serialize the parent mutation clock and item replacement in one transaction.
    expect(service).toMatch(/updatePlaylist[\s\S]*?this\.db\.transaction[\s\S]*?for\("update"\)[\s\S]*?shouldApplyWrite[\s\S]*?replacePlaylistItems/);
  });

  it("serializes refreshes before evaluation and materializes entries atomically", async () => {
    const evaluator = await readFile(
      new URL("../src/playlists/dynamicPlaylistEvaluator.ts", import.meta.url),
      "utf8",
    );

    expect(evaluator).toMatch(/refresh[\s\S]*?this\.db\.transaction/);
    expect(evaluator).toContain('.for("update")');
    expect(evaluator).toMatch(/transaction[\s\S]*?loadContext[\s\S]*?saveEntries/);
    expect(evaluator).toMatch(/saveEntries[\s\S]*?delete\(playlistEntries\)[\s\S]*?insert\(playlistEntries\)[\s\S]*?updatedAt/);
  });
});
