import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { FfmpegSonosTranscoder } from "../src/media/sonosTranscoder.js";

function childProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.kill = vi.fn();
  return child;
}

afterEach(() => vi.clearAllMocks());

describe("FfmpegSonosTranscoder", () => {
  it("terminates and rejects a process that exceeds its timeout", async () => {
    const child = childProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const transcoder = new FfmpegSonosTranscoder({ executable: "ffmpeg", timeoutMs: 1 });

    const pending = transcoder.transcodeToMp3("source.ogg", "output.mp3");
    await expect(Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error("FFmpeg timed out")), 100))])).rejects.toThrow(/timed out/i);
    expect(child.kill).toHaveBeenCalled();
  });

  it("terminates and rejects when the caller aborts", async () => {
    const child = childProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const controller = new AbortController();
    const transcoder = new FfmpegSonosTranscoder({ executable: "ffmpeg", timeoutMs: 10_000 });
    const pending = transcoder.transcodeToMp3("source.ogg", "output.mp3", controller.signal);

    controller.abort();

    await expect(Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error("FFmpeg aborted")), 100))])).rejects.toThrow(/aborted/i);
    expect(child.kill).toHaveBeenCalled();
  });
});