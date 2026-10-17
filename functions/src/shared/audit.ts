type Data = Record<string, unknown>;

/** Field names whose value differs between two versions of a record (top level only). */
export function changedFields(before: Data | undefined, after: Data | undefined): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const ignore = new Set(['updatedAt', 'updatedBy', 'createdAt', 'createdBy']);
  return [...keys]
    .filter((k) => !ignore.has(k))
    .filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    .sort();
}

/** Classifies a write: create, update, delete (soft), restore, or purge (removed for good). */
export function classifyWrite(before: Data | undefined, after: Data | undefined): string {
  if (!before) return 'create';
  if (!after) return 'purge';
  const wasDeleted = before.deletedAt != null;
  const isDeleted = after.deletedAt != null;
  if (!wasDeleted && isDeleted) return 'delete';
  if (wasDeleted && !isDeleted) return 'restore';
  return 'update';
}
