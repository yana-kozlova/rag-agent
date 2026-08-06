import React from 'react';

// Split on URLs while keeping them (capturing group), then test each part.
const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g;
const URL_TEST_RE = /^https?:\/\/[^\s]+$/;

/** True when the whole string is a single URL (e.g. a bare Zoom/Meet link). */
export function isUrl(value: string): boolean {
  return URL_TEST_RE.test(value.trim());
}

/** A short, human label for a meeting/link URL instead of the raw address. */
export function labelForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('zoom.us')) return 'Zoom';
    if (host.includes('meet.google.com')) return 'Google Meet';
    if (host.includes('teams.microsoft.com') || host.includes('teams.live.com')) return 'Teams';
    if (host.includes('webex.com')) return 'Webex';
    if (host.includes('meet.jit.si')) return 'Jitsi';
    if (host.includes('whereby.com')) return 'Whereby';
    if (host.includes('discord.gg') || host.includes('discord.com')) return 'Discord';
    if (host.includes('slack.com')) return 'Slack';
    return 'Link';
  } catch {
    return 'Link';
  }
}

/**
 * A calendar event's location shown as a clickable pill. When it's a meeting
 * URL, the pill shows a short label ("Zoom") and never truncates away — it sits
 * outside the time line's `truncate`, so it stays visible in narrow widgets.
 * Plain-text locations fall back to `Linkify` (which linkifies any embedded URL).
 */
export function MeetingLink({
  value,
  className = '',
}: {
  value: string;
  className?: string;
}) {
  if (!isUrl(value)) {
    return <Linkify value={value} />;
  }
  return (
    <a
      href={value}
      title={value}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`link link-primary shrink-0 normal-case ${className}`}
    >
      {labelForUrl(value)}
    </a>
  );
}

/**
 * Render text with any http(s) URLs turned into clickable links. The link shows
 * a short label (e.g. "Zoom") instead of the raw address; the full URL stays in
 * `href` and the tooltip. Used for calendar event locations, which often hold a
 * meeting link. `stopPropagation` keeps a click on the link from also
 * triggering a parent row handler.
 */
export function Linkify({
  value,
  linkClassName = 'link link-primary',
}: {
  value: string;
  linkClassName?: string;
}) {
  const parts = value.split(URL_SPLIT_RE).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        URL_TEST_RE.test(part) ? (
          <a
            key={i}
            href={part}
            title={part}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
            onClick={(e) => e.stopPropagation()}
          >
            {labelForUrl(part)}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
