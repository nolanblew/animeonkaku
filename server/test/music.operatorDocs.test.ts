import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AMF operator deployment contract", () => {
  it("documents the hardcoded controller, outage isolation, exact ownership mounts, and dry-run cleanup", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const text of ["http://192.168.68.68:9292/api/v1", "AMF outage", "AMF_LIBRARY_ROOT", "read-only", "/config", "/downloads", "/library", "MEDIA_ROOT", "dry-run"])
      expect(readme).toContain(text);
    expect(readme).toContain("qBittorrent");
    expect(readme).toContain("same container path");
  });

  it("mounts AMF library read-only and keeps canonical media separate in both compose examples", () => {
    for (const name of ["docker-compose.yml", "docker-compose.lan.yml"]) {
      const compose = readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
      expect(compose).toContain("AMF_LIBRARY_ROOT: /mnt/amf-library");
      expect(compose).toContain("/mnt/amf-library:ro");
      expect(compose).toContain("MEDIA_ROOT: /data/media");
    }
  });
});
