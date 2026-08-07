export function kitsuSyncDedupeKey(userId: string): string {
  return `KITSU_SYNC:${userId}`;
}
