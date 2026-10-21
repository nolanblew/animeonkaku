import type { JobHandler } from "../../jobs/types.js";
import type { MusicSearchPolicyService } from "./service.js";

export function createMusicSearchPolicyHandlers(
  service: Pick<MusicSearchPolicyService, "reconcile" | "reconcileAnime">,
): Record<"RECONCILE_MUSIC_SEARCH_POLICY", JobHandler> {
  return {
    RECONCILE_MUSIC_SEARCH_POLICY: async (payload) => {
      if ("kitsuId" in payload || "userId" in payload) {
        if (typeof payload.userId !== "string" || !payload.userId || typeof payload.kitsuId !== "string" || !payload.kitsuId) {
          throw new Error("Automatic music policy job requires userId and kitsuId.");
        }
        await service.reconcileAnime({ userId: payload.userId, kitsuId: payload.kitsuId });
      } else await service.reconcile();
    },
  };
}
