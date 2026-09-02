/**
 * Cloudflare challenge detection shared between the browser engine (`browser.ts`,
 * which runs it against a live Playwright page) and the plain-HTTP fetch path
 * (`fetch.ts`, which runs it against fetched HTML). This module is deliberately
 * dependency-free — it pulls in neither Playwright nor cheerio — so the light
 * fetch path never loads the browser engine.
 */

/** Shared Cloudflare interstitial markers (title/body text, case-insensitive). */
export const CHALLENGE_MARKERS =
  /just a moment|nur einen moment|sicherheitsüberprüfung|checking your browser|verifying you are human|un momento|un instant/;

/**
 * Whether raw HTML looks like a Cloudflare (or similar) interstitial rather than
 * the real page. Operates on the plain-text form of the title + body already
 * extracted by the caller (cheerio's `$('title').text()` / `$('body').text()`),
 * plus a flag for the Turnstile response input the challenge page injects.
 *
 * Kept string-based (no DOM) so it works identically for fetched HTML and for a
 * live page's `textContent`.
 */
export function textLooksLikeChallenge(
  titleAndBodyText: string,
  hasTurnstileInput: boolean
): boolean {
  if (hasTurnstileInput) return true;
  return CHALLENGE_MARKERS.test(titleAndBodyText.toLowerCase());
}
