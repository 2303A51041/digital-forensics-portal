import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs an async loader when its dependencies change and exposes { data, error, loading, reload }.
 * Results from an older run are ignored if a newer run has started, so fast filter changes are safe.
 */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const run = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const current = ++run.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await loader();
      if (current === run.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (current === run.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, deps);

  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
