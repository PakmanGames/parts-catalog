import { useCallback, useEffect, useState } from "react";
import { toError } from "@/lib/utils";

export type ApiData<T> =
  /** `previous` is the last loaded data, kept so a page can show it while the next load runs. */
  | { status: "loading"; previous?: T }
  | { status: "error"; error: Error }
  | { status: "ready"; data: T };

/**
 * Loads data from the API on mount and again whenever `load` changes, so wrap `load` in
 * `useCallback`. A load that is superseded or unmounted is aborted and its result ignored, so a slow
 * response can never overwrite a newer one.
 */
export function useApiData<T>(
  load: (signal: AbortSignal) => Promise<T>,
): ApiData<T> & { reload: () => void } {
  const [state, setState] = useState<ApiData<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` isn't read, it only re-runs the load on `reload`.
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({
      status: "loading",
      previous:
        current.status === "ready"
          ? current.data
          : current.status === "loading"
            ? current.previous
            : undefined,
    }));
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", data });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", error: toError(error) });
        }
      },
    );
    return () => controller.abort();
  }, [load, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
