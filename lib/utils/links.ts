/**
 * What makes a link target an address at all.
 *
 * Shared by the chat renderer, the Telegram history and the grounding in
 * `lib/ai/grounded-links.ts`. Dependency-free so the client renderer can import
 * it without dragging anything server-side into the browser — same reason as
 * `lib/utils/uploadable.ts`.
 */

/** `[label](target)` — the shape both renderers turn into a link. */
export const MARKDOWN_LINK = /\[([^\]]*)\]\(([^()\s]*)\)/g;

/** A single leading slash: a page of this app. `//host` is protocol-relative and off-site. */
export function isAppPath(href: string): boolean {
  return /^\/(?!\/)/.test(href);
}

/**
 * Names that point at nothing on the public internet.
 *
 * RFC 2606 and 6761 reserve them for documentation, tests and the local
 * machine — which is exactly why a model reaching for a stand-in lands on them.
 */
const RESERVED_TLDS = new Set(['example', 'invalid', 'test', 'localhost', 'local']);
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

/**
 * Whether an absolute URL could open onto anything.
 *
 * Not whether it does — nothing here fetches — only whether its host is the
 * kind that exists. `https://your-link-to-the-resource/` is the case this is
 * for: a hostname with no dot is not a place, it is a sentence with hyphens in
 * it, and five saved replies rendered one as a clickable link.
 */
export function isReachableUrl(href: string): boolean {
  let host: string;
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    host = url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }

  if (!host.includes('.')) return false;
  if (RESERVED_TLDS.has(host.slice(host.lastIndexOf('.') + 1))) return false;
  return !RESERVED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Reduce every link to a host that cannot exist down to its label.
 *
 * For replies written before links were grounded, which are still read: shown
 * in the chat history, and replayed to the model as its own earlier words —
 * where a stand-in link is an example to follow.
 */
export function unlinkUnreachable(text: string): string {
  return text.replace(MARKDOWN_LINK, (whole, label: string, target: string) =>
    /^https?:\/\//i.test(target) && !isReachableUrl(target) ? label : whole
  );
}
