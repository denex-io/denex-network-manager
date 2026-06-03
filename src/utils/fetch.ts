/**
 * Fetch wrapper that handles *.localhost DNS resolution.
 * Deno's fetch may not resolve *.localhost subdomains correctly on all platforms.
 * This wrapper converts *.localhost URLs to 127.0.0.1 with a Host header.
 */
export function localnetFetch(
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const urlObj = new URL(url);
  const originalHost = urlObj.hostname;

  if (urlObj.hostname.endsWith('.localhost')) {
    urlObj.hostname = '127.0.0.1';
    const headers = new Headers(init?.headers);
    headers.set('Host', originalHost);
    init = { ...init, headers };
  }

  return fetch(urlObj.toString(), init);
}
