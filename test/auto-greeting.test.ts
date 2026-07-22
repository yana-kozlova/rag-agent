import { describe, it, expect } from 'vitest';
import {
  AUTO_GREETING_MARKER,
  isAutoGreetingText,
  stripAutoGreetingMarker,
} from '@/lib/chat/auto-greeting';

const PROMPT = "Greet the user briefly and summarize today's (July 22, 2026) schedule. Provide life-affirming phrase on the basis of busyness of the day.";

describe('auto-greeting detection', () => {
  it('detects a marker-tagged prompt', () => {
    expect(isAutoGreetingText(`${AUTO_GREETING_MARKER}${PROMPT}`)).toBe(true);
  });

  it('detects a legacy (pre-marker) prompt already in history', () => {
    expect(isAutoGreetingText(PROMPT)).toBe(true);
  });

  it('does not flag an ordinary user message', () => {
    expect(isAutoGreetingText('what is on my calendar today?')).toBe(false);
    expect(isAutoGreetingText('')).toBe(false);
    expect(isAutoGreetingText(null)).toBe(false);
  });

  it('strips the marker back to the plain prompt the model should see', () => {
    const stripped = stripAutoGreetingMarker(`${AUTO_GREETING_MARKER}${PROMPT}`);
    expect(stripped).toBe(PROMPT);
    expect(stripped).not.toContain('​');
  });

  it('leaves marker-free text untouched', () => {
    expect(stripAutoGreetingMarker(PROMPT)).toBe(PROMPT);
  });
});
