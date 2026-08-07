import type { AppLogger } from "../../logging.js";

/**
 * Optional repair for data imported before AMF exposed localized catalog
 * metadata. It is deliberately scheduled by the runtime after `listen()` so
 * an unavailable provider can never delay health/readiness.
 */
export function startLocalizedCatalogBackfill(deps: {
  repo: {
    listLocalizedCatalogBackfillTargets(): Promise<Array<{ batchId: string; amfJobId: string }>>;
    recordProviderEvidence(batchId: string, job: unknown, now: Date): Promise<void>;
    backfillLocalizedCatalog(): Promise<number>;
  };
  client: { getJob(id: string): Promise<unknown> };
  logger: Pick<AppLogger, "info" | "warn">;
  schedule: (task: () => Promise<void>) => void;
}): void {
  deps.schedule(async () => {
    try {
      for (const target of await deps.repo.listLocalizedCatalogBackfillTargets()) {
        try {
          await deps.repo.recordProviderEvidence(target.batchId, await deps.client.getJob(target.amfJobId), new Date());
        } catch (error) {
          deps.logger.warn?.({ batchId: target.batchId, err: error }, "AMF localized metadata backfill job was unavailable");
        }
      }
      const localizedCatalogRows = await deps.repo.backfillLocalizedCatalog();
      if (localizedCatalogRows > 0) {
        deps.logger.info({ localizedCatalogRows }, "backfilled AMF localized catalog metadata");
      }
    } catch (error) {
      deps.logger.warn?.({ err: error }, "unable to backfill AMF localized catalog metadata");
    }
  });
}
