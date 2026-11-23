import { it, expect, vi } from 'vitest';
import { waitForBackend } from '../../templates/hitl-workplace-agent/scripts/backend-readiness.mjs';

it('waits through connection refusal and unsuccessful health responses before accepting readiness', async () => {
  const fetchFn = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  await waitForBackend('http://localhost:4000/', { fetchFn, intervalMs: 1, timeoutMs: 1000 });
  expect(fetchFn).toHaveBeenCalledTimes(3);
  expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:4000/health');
});
it('reports a persistent backend failure with the endpoint and recovery action', async () => {
  await expect(waitForBackend('http://localhost:4000', {
    fetchFn: async () => new Response(null, { status: 503 }), intervalMs: 1, timeoutMs: 15,
  })).rejects.toThrow(/Backend did not become ready.*HTTP 503.*PORT\/EXPRESS_ORIGIN/);
});
it('does not probe or start anything after cancellation', async () => {
  const controller = new AbortController(); controller.abort(new Error('stopped'));
  const fetchFn = vi.fn();
  await expect(waitForBackend('http://localhost:4000', { signal: controller.signal, fetchFn })).rejects.toThrow('stopped');
  expect(fetchFn).not.toHaveBeenCalled();
});
it('cancels an in-flight health request promptly', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const fetchFn = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started();
  }));
  const work = waitForBackend('http://localhost:4000', { signal: controller.signal, fetchFn });
  const assertion = expect(work).rejects.toThrow('stopped');
  await requestStarted; controller.abort(new Error('stopped')); await assertion;
});
