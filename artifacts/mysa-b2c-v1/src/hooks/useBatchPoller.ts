import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type BatchState = {
  batchId: string;
  leadsCount: number;
  status: "in_progress" | "complete";
};

export interface UseBatchPollerOptions {
  buildPollUrl: (batchId: string) => string;
  intervalMs?: number;
  onComplete?: (result: { scored: number; leadsCount: number; batchId: string }) => void;
  invalidateQueryKeys?: unknown[][];
  successToast?: string;
}

export function useBatchPoller({
  buildPollUrl,
  intervalMs = 30000,
  onComplete,
  invalidateQueryKeys = [],
  successToast,
}: UseBatchPollerOptions) {
  const qc = useQueryClient();
  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!batchState || batchState.status !== "in_progress") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    const { batchId } = batchState;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(buildPollUrl(batchId), { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as { status: string; scored?: number; leadsCount: number };
        if (data.status === "complete") {
          const scored = data.scored ?? data.leadsCount;
          setBatchState(prev => prev ? { ...prev, status: "complete" } : null);
          invalidateQueryKeys.forEach(key => qc.invalidateQueries({ queryKey: key }));
          if (successToast) {
            toast.success(successToast.replace("{scored}", String(scored)));
          }
          onCompleteRef.current?.({ scored, leadsCount: data.leadsCount, batchId });
        }
      } catch { /* ignore poll errors */ }
    }, intervalMs);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [batchState?.status, batchState?.batchId]);

  const startBatch = useCallback((batchId: string, leadsCount: number) => {
    setBatchState({ batchId, leadsCount, status: "in_progress" });
  }, []);

  const clearBatch = useCallback(() => {
    setBatchState(null);
  }, []);

  return {
    batchState,
    isPolling: batchState?.status === "in_progress",
    startBatch,
    clearBatch,
  };
}
