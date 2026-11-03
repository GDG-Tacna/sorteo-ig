const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The API drives a browser with the user's Instagram session, so it only answers
 * requests addressed to this machine and sent from this app. Checking the Host
 * blocks DNS rebinding and hosted deployments; checking the Origin blocks other
 * websites from calling localhost through the visitor's browser.
 */
export function isLocalRequest(
  host: string | null,
  origin: string | null
): boolean {
  if (!host) return false;

  const hostname = host.toLowerCase().replace(/:\d+$/, "");
  if (!LOCAL_HOSTNAMES.has(hostname)) return false;

  if (origin === null) return true;

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
