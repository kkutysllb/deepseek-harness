/**
 * The /api URL prefix — single source for both halves of the web transport.
 * The node half registers this prefix on the web server.
 */

/** Route prefix owning every api request (`/api` and `/api/<anything>`). */
export const API_PATH = '/api'

/** One endpoint segment: no separators, no traversal, no empty pieces. */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/**
 * Strip the route prefix off one request path and return the RPC endpoint it
 * carries. A bare prefix, malformed segments, or a foreign path yield
 * undefined - there is nothing to authorize or dispatch.
 * @param channel - the route prefix owning the path (e.g. `/api`).
 * @param pathname - the request path exactly as received.
 * @returns the endpoint, or undefined when the path carries none.
 */
export function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}
