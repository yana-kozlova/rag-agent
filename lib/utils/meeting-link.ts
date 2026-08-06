// Pull a join URL out of a Google Calendar event. Google rarely puts the
// meeting link in `location`; it lives in `hangoutLink` (Meet), in
// `conferenceData.entryPoints` (Zoom/Teams/Webex via add-ons), or is just
// pasted into the description.

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;
const MEETING_HOST_RE =
  /(zoom\.us|meet\.google\.com|teams\.(?:microsoft|live)\.com|webex\.com|meet\.jit\.si|whereby\.com|around\.co|chime\.aws)/i;

/** True when the whole (trimmed) string is a single http(s) URL. */
export function isBareUrl(value?: string | null): boolean {
  return !!value && /^https?:\/\/\S+$/.test(value.trim());
}

/** Best-effort join link for an event, or undefined if none is found. */
export function extractMeetingLink(event: any): string | undefined {
  if (!event) return undefined;

  // 1. Native Google Meet link.
  if (typeof event.hangoutLink === 'string' && event.hangoutLink) {
    return event.hangoutLink;
  }

  // 2. Conferencing add-ons expose a "video" entry point (Zoom, Teams, …).
  const entryPoints = event.conferenceData?.entryPoints;
  if (Array.isArray(entryPoints)) {
    const video = entryPoints.find((e: any) => e?.entryPointType === 'video' && e?.uri);
    if (video?.uri) return video.uri as string;
  }

  // 3. A URL dropped straight into the location field.
  if (typeof event.location === 'string') {
    const locMatch = event.location.match(URL_RE);
    if (locMatch?.length) return locMatch[0];
  }

  // 4. A known conferencing URL sitting in the description text.
  if (typeof event.description === 'string') {
    const urls = event.description.match(URL_RE) || [];
    const meeting = urls.find((u: string) => MEETING_HOST_RE.test(u));
    if (meeting) return meeting;
  }

  return undefined;
}
