import type { ModelMessage, StreamTextTransform, TextStreamPart, ToolSet } from 'ai';
import { MARKDOWN_LINK, isAppPath } from '@/lib/utils/links';

/**
 * Every link in a reply, checked against the addresses the application handed over.
 *
 * "A link is an address a tool handed you, never one you compose" was a prompt
 * rule, and after it was sharpened — and after the tool that made it
 * unfollowable was fixed — the model went on writing
 * `[Деталі тут](https://your-link-to-the-resource/)` beside an `addResource`
 * result carrying the note's real `/resources/<id>`, and
 * `[тут](https://your-link-to-the-table/)` about a table whose tools returned no
 * address at all. A prompt is a tendency. What makes the rule hold is checking
 * the output, and the check is cheap because the application knows exactly what
 * it supplied: a target stays linked when it occurs in what the user said or in
 * what a tool returned, and otherwise the link is reduced to its words — "named,
 * not linked", which the prompt already calls a complete answer.
 *
 * Strict on purpose, outside addresses included. A URL the model knows from
 * training loses its link and keeps its label, which costs little in an
 * assistant over the user's own things; the alternative is judging which
 * invented addresses look invented, and `https://drive.google.com/file/d/…`
 * looks exactly as real as a real one.
 */

/** The app's own top-level pages. They exist whatever the turn looked at. */
const APP_PAGES = new Set([
  '/',
  '/resources',
  '/tables',
  '/timeline',
  '/tasks',
  '/health',
  '/entities',
  '/settings',
]);

/** A Markdown link or a bare URL — the two shapes a renderer makes clickable. */
const LINK_OR_URL = new RegExp(`${MARKDOWN_LINK.source}|(https?:\\/\\/\\S+)`, 'g');

/** A URL written mid-sentence swallows the punctuation after it; same rule as the web renderer. */
function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]}'"»]+$/, '');
}

/** What continues an address rather than ending it: `/resources/ab` is not `/resources/abc`. */
const ADDRESS_CHAR = /[A-Za-z0-9_-]/;

/** Whether `address` occurs in `grounds` whole, rather than as the front of a longer one. */
function mentions(grounds: string, address: string): boolean {
  const needle = address.length > 1 ? address.replace(/\/+$/, '') : address;
  if (!needle) return false;

  for (let at = grounds.indexOf(needle); at !== -1; at = grounds.indexOf(needle, at + 1)) {
    const next = grounds[at + needle.length];
    if (next === undefined || !ADDRESS_CHAR.test(next)) return true;
  }
  return false;
}

/** `/tasks`, `/tasks/`, `/settings#google` — the page, whatever rides after it. */
function isAppPage(path: string): boolean {
  return APP_PAGES.has(path.split(/[?#]/)[0].replace(/(.)\/+$/, '$1'));
}

function pathOf(href: string): string | null {
  try {
    const url = new URL(href);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** The target to keep, or null to drop the link and keep its words. */
function resolve(target: string, grounds: string): string | null {
  const href = target.trim();
  if (!href) return null;

  // Handed over as it stands — by a tool, or by the user typing it.
  if (mentions(grounds, href)) return href;

  if (isAppPath(href)) return isAppPage(href) ? href : null;

  if (/^https?:\/\//i.test(href)) {
    // A real address with a host put in front of it. The host is invented —
    // the model is never told where the app lives — but the path is ours, and
    // a path is what works on both surfaces. Never a bare page name: that is
    // how `en.wikipedia.org/tasks` would become the user's task list.
    const path = pathOf(href);
    return path && isAppPath(path) && !isAppPage(path) && mentions(grounds, path) ? path : null;
  }

  if (/^mailto:/i.test(href)) {
    const address = href.slice('mailto:'.length).split('?')[0];
    return address && mentions(grounds, address) ? href : null;
  }

  return null;
}

/**
 * The text with every link nobody supplied reduced to its words.
 *
 * A bare URL has no words to fall back on — it is its own label — so one that
 * nobody supplied goes entirely. Left as text, both surfaces would turn it
 * straight back into a link.
 */
export function groundLinks(text: string, grounds: string): string {
  return text.replace(
    LINK_OR_URL,
    (_token, label: string | undefined, target: string | undefined, bare: string | undefined) => {
      if (bare !== undefined) {
        const url = trimTrailingPunctuation(bare);
        return (mentions(grounds, url) ? url : '') + bare.slice(url.length);
      }

      const kept = resolve(target ?? '', grounds);
      // The label goes through again: `[https://…](https://…)` would otherwise
      // leave the invented address standing as a bare one.
      return kept ? `[${label}](${kept})` : groundLinks(label ?? '', grounds);
    }
  );
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

/**
 * What the user said and what the tools answered — never what the assistant wrote.
 *
 * Its own earlier replies are the one text that cannot vouch for a link: five
 * saved ones carry `https://your-link-to-the-resource/`, and counting them
 * would let each stand-in ground the next.
 */
export function groundsFrom(messages: readonly ModelMessage[]): string {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'tool')
    .map((message) => stringify(message.content))
    .join('\n');
}

/** How far an unclosed `[` may run before it stops being a link in progress. */
const MAX_PENDING = 400;

/** A link cut off by the end of the text: `[label`, `[label]`, `[label](targ`. */
const LINK_IN_PROGRESS = /^\[[^\]]*(?:\](?:\([^()\s]*)?)?$/;

/**
 * How much of `text` can be grounded now.
 *
 * A link has to be seen whole to be judged, and a stream hands it over in
 * pieces — `[Рост`, `ік](/resources/ab`, `c123)`. Everything before the first
 * piece that may still belong to one is settled; the rest waits for the next
 * delta. The word still being written is always held, since it may be the
 * front half of a bare URL.
 */
export function settledLength(text: string): number {
  let cut = /\S*$/.exec(text)?.index ?? text.length;

  for (let at = text.indexOf('['); at !== -1 && at < cut; at = text.indexOf('[', at + 1)) {
    if (text.length - at <= MAX_PENDING && LINK_IN_PROGRESS.test(text.slice(at))) {
      cut = at;
      break;
    }
  }

  // Never inside a link that is already whole, or half of it would be judged
  // without the other.
  for (const match of text.matchAll(LINK_OR_URL)) {
    const start = match.index ?? 0;
    if (start >= cut) break;
    if (start + match[0].length > cut) {
      cut = start;
      break;
    }
  }

  return cut;
}

export type LinkGrounder = {
  /** Take the next piece of text; returns whatever part of it is now settled, grounded. */
  push(delta: string): string;
  /** The text has ended: ground and return whatever was held back. */
  flush(): string;
};

/** Grounding for text that arrives in pieces; the pieces together equal `groundLinks` on the whole. */
export function createLinkGrounder(grounds: () => string): LinkGrounder {
  let held = '';

  return {
    push(delta) {
      held += delta;
      const settled = settledLength(held);
      if (settled === 0) return '';
      const ready = held.slice(0, settled);
      held = held.slice(settled);
      return groundLinks(ready, grounds());
    },
    flush() {
      const rest = held;
      held = '';
      return rest ? groundLinks(rest, grounds()) : '';
    },
  };
}

/**
 * The same check on a streamed reply, for `streamText`'s `experimental_transform`.
 *
 * It runs before both the UI stream and `onFinish`, so what the user watches
 * arrive and what the client then saves to history are the same grounded text.
 * Tool results are read as they pass: a step's results always come through
 * before the text of the step that answers from them.
 */
export function groundLinksTransform<TOOLS extends ToolSet>(seed: string): StreamTextTransform<TOOLS> {
  return () => {
    let grounds = seed;
    const open = new Map<string, LinkGrounder>();

    const release = (
      id: string,
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
    ) => {
      const rest = open.get(id)?.flush();
      open.delete(id);
      if (rest) controller.enqueue({ type: 'text-delta', id, text: rest });
    };

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, controller) {
        switch (part.type) {
          case 'tool-result':
            grounds += `\n${stringify(part.output)}`;
            break;
          case 'text-delta': {
            let grounder = open.get(part.id);
            if (!grounder) {
              grounder = createLinkGrounder(() => grounds);
              open.set(part.id, grounder);
            }
            const text = grounder.push(part.text);
            if (text) controller.enqueue({ ...part, text });
            return;
          }
          case 'text-end':
            release(part.id, controller);
            break;
          case 'finish-step':
            for (const id of [...open.keys()]) release(id, controller);
            break;
        }
        controller.enqueue(part);
      },
      flush(controller) {
        for (const id of [...open.keys()]) release(id, controller);
      },
    });
  };
}
