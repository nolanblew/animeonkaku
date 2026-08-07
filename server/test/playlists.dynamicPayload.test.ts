import { describe, expect, it } from "vitest";
import { dynamicPlaylistPayload } from "../src/playlists/dynamicPlaylistEvaluator.js";

describe("dynamicPlaylistPayload", () => {
  it("extracts Android dynamic spec envelopes", () => {
    const envelope = JSON.stringify({
      filterJson: { type: "liked" },
      sortJson: { keys: [{ attribute: "TITLE", direction: "ASC" }] },
      mode: "AUTO",
      createdMode: "SIMPLE",
      schemaVersion: 1,
    });

    expect(dynamicPlaylistPayload(envelope, null)).toEqual({
      filter: { type: "liked" },
      sort: { keys: [{ attribute: "TITLE", direction: "ASC" }] },
    });
  });

  it("keeps raw filter nodes and prefers explicit sort JSON", () => {
    expect(
      dynamicPlaylistPayload(
        JSON.stringify({ type: "theme_type_in", types: ["OP"] }),
        JSON.stringify({ keys: [{ attribute: "PLAY_COUNT", direction: "DESC" }] }),
      ),
    ).toEqual({
      filter: { type: "theme_type_in", types: ["OP"] },
      sort: { keys: [{ attribute: "PLAY_COUNT", direction: "DESC" }] },
    });
  });
});
