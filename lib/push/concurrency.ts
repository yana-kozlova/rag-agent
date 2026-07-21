/**
 * Map over items with a bounded number of in-flight promises, preserving input
 * order in the result.
 *
 * The dispatcher publishes one QStash message per due user; doing that
 * sequentially would turn thousands of ~50ms calls into minutes and blow the
 * function's time budget, while doing them all at once would hammer the API.
 * A small in-flight window is the middle ground.
 *
 * Never rejects: a failing item resolves to its mapped error value via `fn`,
 * so one bad publish can't abort the whole fan-out.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
