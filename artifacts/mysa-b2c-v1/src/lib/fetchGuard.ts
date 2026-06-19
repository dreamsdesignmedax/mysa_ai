const PLAN_ERROR_CODES = new Set(["PLAN_LIMIT", "TRIAL_EXPIRED", "LIMIT_EXCEEDED"]);

export interface PlanLimitDetail {
  errorCode: string;
  resource?: string;
  feature?: string;
  message: string;
  limit?: number;
  used?: number;
}

declare global {
  interface WindowEventMap {
    "plan-limit-hit": CustomEvent<PlanLimitDetail>;
  }
}

/**
 * Parse a JSON body object (or unknown value) for plan-limit error codes.
 * Returns a PlanLimitDetail if a recognised code is found, otherwise null.
 * Safe to call with any value — never throws.
 */
export function tryParsePlanLimit(body: unknown): PlanLimitDetail | null {
  try {
    if (typeof body !== "object" || body === null) return null;
    const b = body as Record<string, unknown>;
    const errorField = typeof b.error === "string" ? b.error : undefined;
    const codeField  = typeof b.code  === "string" ? b.code  : undefined;
    const matched =
      (errorField && PLAN_ERROR_CODES.has(errorField) ? errorField : null) ??
      (codeField  && PLAN_ERROR_CODES.has(codeField)  ? codeField  : null);
    if (!matched) return null;
    return {
      errorCode: matched,
      resource:  typeof b.resource === "string" ? b.resource : undefined,
      feature:   typeof b.feature  === "string" ? b.feature  : undefined,
      message:
        (typeof b.message === "string" ? b.message : undefined) ??
        "You've reached a limit on your current plan.",
      limit: typeof b.limit === "number" ? b.limit : undefined,
      used:  typeof b.used  === "number" ? b.used  : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Dispatch a plan-limit-hit CustomEvent on the window.
 * Call this from SSE / EventSource error handlers that bypass fetchGuard,
 * or from any code path that needs to surface the upgrade wall manually.
 */
export function dispatchPlanLimitEvent(detail: PlanLimitDetail): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plan-limit-hit", { detail }));
  }
}

let installed = false;

export function installFetchGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const _fetch = window.fetch.bind(window);

  window.fetch = async function guardedFetch(input, init) {
    const response = await _fetch(input, init);

    if (response.status === 402 || response.status === 403) {
      try {
        const cloned = response.clone();
        const body = await cloned.json() as Record<string, unknown>;
        const detail = tryParsePlanLimit(body);
        if (detail) {
          dispatchPlanLimitEvent(detail);
        }
      } catch {
        // Body was not JSON or not parseable — ignore
      }
    }

    return response;
  };
}
