import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  animeMusicReleases,
  mediaFiles,
  musicAcquisitions,
  musicDiscoveryState,
  musicReleases,
  playEvents,
  playlistEntries,
  playlists,
  releaseTracks,
  songPrefs,
  songs,
  themeFullSongs,
  themePrefs,
  themeVideoSources,
} from "../src/db/schema.js";

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("music catalog schema contract", () => {
  it("exports every global catalog and acquisition table", () => {
    expect([
      songs,
      musicReleases,
      releaseTracks,
      animeMusicReleases,
      themeFullSongs,
      themeVideoSources,
      musicDiscoveryState,
      musicAcquisitions,
      songPrefs,
      playEvents,
    ].map((table) => getTableConfig(table).name)).toEqual([
      "songs",
      "music_releases",
      "release_tracks",
      "anime_music_releases",
      "theme_full_songs",
      "theme_video_sources",
      "music_discovery_state",
      "music_acquisitions",
      "song_prefs",
      "play_events",
    ]);
  });

  it("allows one provider command to reconcile multiple durable catalog intents", () => {
    const config = getTableConfig(musicAcquisitions);
    expect(config.uniqueConstraints.some((constraint) => constraint.name === "music_acquisitions_provider_job_unique"))
      .toBe(false);
    expect(config.indexes.some((index) => index.config.name === "music_acquisitions_provider_job_idx"))
      .toBe(true);
  });

  it("extends existing media, playlist, and preference rows without changing TV media identity", () => {
    expect(columnNames(mediaFiles)).toEqual(expect.arrayContaining([
      "kind",
      "ref_id",
      "variant",
      "content_type",
      "source_file_name",
    ]));
    expect(columnNames(playlists)).toContain("default_mode");
    expect(columnNames(playlistEntries)).toEqual(expect.arrayContaining([
      "id",
      "playlist_id",
      "item_type",
      "item_id",
      "order_index",
      "mode_override",
    ]));
    expect(columnNames(playlistEntries)).not.toContain("theme_id");
    expect(columnNames(themePrefs)).toEqual(expect.arrayContaining([
      "disliked_tv_size",
      "disliked_full_size",
    ]));
  });

  it("keeps occurrence identity separate from playlist item identity", () => {
    const config = getTableConfig(playlistEntries);
    expect(config.primaryKeys).toHaveLength(0);
    expect(config.columns.find((column) => column.name === "id")?.primary).toBe(true);
    expect(config.indexes.some((index) => index.config.name === "playlist_entries_playlist_order_idx"))
      .toBe(true);
  });
});
