import { describe, expect, it } from 'vitest';

import { isEmailAllowed, parseAllowlist } from '@/lib/auth/allowlist';

describe('parseAllowlist', () => {
  it('tolerates the shapes a person actually types into an env var', () => {
    expect(parseAllowlist(' A@B.com ,, c@d.com,')).toEqual(['a@b.com', 'c@d.com']);
  });

  it('treats unset and blank alike', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist('  ,  ')).toEqual([]);
  });
});

describe('isEmailAllowed', () => {
  it('lets everyone in when no list is configured', () => {
    // The deploy that introduced this check must not lock the owner out.
    expect(isEmailAllowed('stranger@example.com', undefined)).toBe(true);
    expect(isEmailAllowed('stranger@example.com', '')).toBe(true);
  });

  it('admits a listed address and refuses everything else', () => {
    const list = 'owner@gmail.com, friend@gmail.com';
    expect(isEmailAllowed('friend@gmail.com', list)).toBe(true);
    expect(isEmailAllowed('someone@gmail.com', list)).toBe(false);
  });

  it('ignores case and stray whitespace on both sides', () => {
    expect(isEmailAllowed('  Owner@Gmail.COM ', 'owner@gmail.com')).toBe(true);
  });

  it('reads an @-prefixed entry as a whole domain', () => {
    expect(isEmailAllowed('anyone@team.com', '@team.com')).toBe(true);
    expect(isEmailAllowed('anyone@nother.com', '@team.com')).toBe(false);
  });

  it('does not let a domain entry match an address that merely ends with it', () => {
    // `evil-team.com` ends in `team.com`; only the part after the @ counts.
    expect(isEmailAllowed('someone@evil-team.com', '@team.com')).toBe(false);
  });

  it('refuses an account with no email once a list exists', () => {
    expect(isEmailAllowed(undefined, 'owner@gmail.com')).toBe(false);
    expect(isEmailAllowed('', 'owner@gmail.com')).toBe(false);
  });
});
