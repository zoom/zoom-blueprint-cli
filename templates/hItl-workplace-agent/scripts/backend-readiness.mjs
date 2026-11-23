import { setTimeout as delay } from 'node:timers/promises';

/** Wait on Express directly before starting the frontend that proxies requests to it. */
export async function waitForBackend(origin, { signal, timeoutMs = 20000, intervalMs = 200, fetchFn = fetch } = {}) {
  const url = `${origin.replace(/\/+$/, '')}/health`;
  const deadline = Date.now() + timeoutMs;
  let lastProblem = 'no response';
  for (;;) {
    signal?.throwIfAborted();
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now())))])
        : AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now())));
      const response = await fetchFn(url, { signal: requestSignal });
      await response.body?.cancel();
      if (response.ok) return;
      lastProblem = `HTTP ${response.status}`;
    } catch (error) {
      signal?.throwIfAborted();
      lastProblem = error.cause?.code || error.message;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Backend did not become ready at ${url} (${lastProblem}). Check the backend errors and PORT/EXPRESS_ORIGIN in .env, then restart.`);
    }
    await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())), undefined, { signal });
  }
}
