const locks = new Map<string, Promise<void>>();

export function withMediaLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tracked = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(id, tracked);
  void tracked.then(() => {
    if (locks.get(id) === tracked) locks.delete(id);
  });
  return run;
}
