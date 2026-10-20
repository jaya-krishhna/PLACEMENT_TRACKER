export interface HasTimestamps {
  updatedAt: Date | string;
  lastEmailAt?: Date | string | null;
  createdAt?: Date | string;
}

/**
 * Returns the effective timestamp for an application: the later of updatedAt and lastEmailAt.
 */
export function getEffectiveTimestamp(item: HasTimestamps): number {
  const updatedTime = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
  const emailTime = item.lastEmailAt ? new Date(item.lastEmailAt).getTime() : 0;
  return Math.max(
    Number.isNaN(updatedTime) ? 0 : updatedTime,
    Number.isNaN(emailTime) ? 0 : emailTime,
  );
}

/**
 * Sorts applications by recently updated: the later of updatedAt and lastEmailAt descending.
 */
export function sortByRecentlyUpdated<T extends HasTimestamps>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const timeA = getEffectiveTimestamp(a);
    const timeB = getEffectiveTimestamp(b);
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return createdB - createdA;
  });
}
