import React from 'react';
import Link from 'next/link';

// Lightweight markdown renderer for headings (###), lists (- ), **bold** and links.

/**
 * A destination worth turning into a link, or null.
 *
 * Three shapes qualify: an in-app path, an absolute http(s) URL, and mailto.
 * Everything else renders as its label alone — `javascript:` because it is an
 * attack, and `#<id>` because that is what the model invents when it wants to
 * point at a note and has not been given the note's real address. A link that
 * silently goes nowhere is worse than plain text: it looks clickable.
 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (/^mailto:\S+$/i.test(href)) return href;
  // A single leading slash: an app path. `//host` is protocol-relative and off-site.
  if (/^\/(?!\/)/.test(href)) return href;
  return null;
}

/** `**bold**`, `[label](href)`, or a bare URL — whichever comes first. */
const INLINE_TOKEN = /(\*\*[^*]+\*\*)|\[([^\]]*)\]\(([^()\s]*)\)|(https?:\/\/\S+)/g;

/** A URL written mid-sentence swallows the punctuation that follows it. */
function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]}'"»]+$/, '');
}

const LINK_CLASS = 'link link-primary break-words';

function anchor(href: string, label: string, key: string): React.ReactNode {
  const safe = safeHref(href);
  if (!safe) return <React.Fragment key={key}>{label}</React.Fragment>;

  // Internal navigation stays client-side; anything off-site opens elsewhere so
  // that following a citation does not throw away the conversation.
  return safe.startsWith('/') ? (
    <Link key={key} href={safe} className={LINK_CLASS}>
      {label}
    </Link>
  ) : (
    <a key={key} href={safe} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {label}
    </a>
  );
}

export function renderSimpleMarkdown(text: string): JSX.Element {
  const lines = text.split(/\n+/);
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const renderInline = (s: string): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const pattern = new RegExp(INLINE_TOKEN.source, 'g');
    let last = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(s)) !== null) {
      const [token, bold, linkLabel, linkHref, bareUrl] = match;
      if (match.index > last) out.push(s.slice(last, match.index));

      if (bold !== undefined) {
        out.push(<strong key={`b-${match.index}`}>{bold.slice(2, -2)}</strong>);
      } else if (bareUrl !== undefined) {
        const url = trimTrailingPunctuation(bareUrl);
        out.push(anchor(url, url, `u-${match.index}`));
        last = match.index + url.length;
        pattern.lastIndex = last;
        continue;
      } else {
        out.push(anchor(linkHref, linkLabel || linkHref, `l-${match.index}`));
      }

      last = match.index + token.length;
    }

    if (last < s.length) out.push(s.slice(last));
    return out;
  };

  const flushList = () => {
    if (listBuffer.length > 0) {
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="list-disc ml-5 space-y-1">
          {listBuffer.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  lines.forEach((l) => {
    if (l.startsWith('### ')) {
      flushList();
      nodes.push(
        <div key={`h3-${nodes.length}`} className="font-semibold mt-2">
          {l.replace(/^###\s+/, '')}
        </div>
      );
      return;
    }
    if (l.startsWith('- ')) {
      listBuffer.push(l.slice(2));
      return;
    }
    flushList();
    if (l.trim().length > 0) {
      nodes.push(
        <p key={`p-${nodes.length}`} className="mt-1">
          {renderInline(l)}
        </p>
      );
    }
  });
  flushList();
  return <div className="space-y-1">{nodes}</div>;
}
