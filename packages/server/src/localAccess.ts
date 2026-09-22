import type { IncomingHttpHeaders } from 'node:http';

/** Local browser boundary, not authentication against other local processes. */
export function localRequestAllowed(headers: IncomingHttpHeaders): boolean {
  const host = headers.host;
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return false;
  if (headers['sec-fetch-site'] === 'cross-site') return false;
  try {
    const expected = new URL(`http://${host}`).origin;
    // Native clients do not send Origin; browsers must match the serving origin.
    return headers.origin === undefined || headers.origin === expected;
  } catch {
    return false;
  }
}
