export function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeTimesToLocal(text: string): string {
  if (!text || typeof text !== 'string') return text;
  const isoRegex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2}))/gi;
  return text.replace(isoRegex, (match) => {
    const dt = new Date(match);
    if (isNaN(dt.getTime())) return match;
    return dt.toLocaleString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  });
}


