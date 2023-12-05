/**
 * A function that debounces on both the leading and trailing ends.
 *
 * The debounced function returns a promise that returns the next time the
 * function is run. (Note that the function won't necessarily be run with the
 * arguments provided at this run.)
 */
export default function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let deferredRunFn: (() => ReturnType<T>) | undefined;
  let deferredResolves: ((value: ReturnType<T>) => void)[] = [];

  return function debounced(
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ) {
    return new Promise<Awaited<ReturnType<T>>>((resolve) => {
      const runFn = () => {
        const result = fn.apply(this, args);
        resolve(result);
        for (const deferredResolve of deferredResolves) {
          deferredResolve(result);
        }
        deferredResolves = [];
        return result;
      };

      const immediate = timeout == null;
      if (immediate) {
        runFn();
        deferredRunFn = undefined;
      } else {
        deferredRunFn = runFn;
        deferredResolves.push(resolve);
      }

      clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = undefined;
        if (deferredRunFn != null) {
          deferredRunFn();
          deferredRunFn = undefined;
        }
      }, delay);
    });
  };
}
