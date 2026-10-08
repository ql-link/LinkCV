import { useEffect, useState } from "react";
import { api, type JobMatchRecommendations } from "../../api/client";

const POLL_MS = 3000;
const POLL_LIMIT = 20;

export type JobMatchRecommendationsView = {
  status: "loading" | "ready" | "error";
  data: JobMatchRecommendations | null;
  /** Still computing after the polling budget ran out. */
  stalled: boolean;
};

/**
 * Loads the home card's matches and, when nothing usable exists yet, asks the
 * server to start computing, then polls. Mount it only while the card is shown.
 */
export function useJobMatchRecommendations(enabled: boolean): JobMatchRecommendationsView {
  const [view, setView] = useState<JobMatchRecommendationsView>({ status: "loading", data: null, stalled: false });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    let polls = 0;

    const accept = (data: JobMatchRecommendations) => {
      if (cancelled) return;
      const waiting = data.pending_count > 0;
      setView({ status: "ready", data, stalled: waiting && polls >= POLL_LIMIT });
      if (waiting && polls < POLL_LIMIT) {
        polls += 1;
        timer = window.setTimeout(() => {
          void api.getJobMatchRecommendations().then(accept).catch(fail);
        }, POLL_MS);
      }
    };
    const fail = () => {
      if (!cancelled) setView((current) => ({ status: "error", data: current.data, stalled: false }));
    };

    void api.getJobMatchRecommendations()
      .then((data) => (data.can_compute ? api.ensureJobMatchRecommendations() : data))
      .then(accept)
      .catch(fail);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  return view;
}
