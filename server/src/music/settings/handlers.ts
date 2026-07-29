import type { JobHandler } from "../../jobs/types.js";
import type { MusicSearchPolicyService } from "./service.js";

export function createMusicSearchPolicyHandlers(
  service: Pick<MusicSearchPolicyService, "reconcile">,
): Record<"RECONCILE_MUSIC_SEARCH_POLICY", JobHandler> {
  return {
    RECONCILE_MUSIC_SEARCH_POLICY: async () => { await service.reconcile(); },
  };
}
