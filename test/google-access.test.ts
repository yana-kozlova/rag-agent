import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The one distinction this module exists to draw: a permission Google has ended
 * (which only the user can repair, and must be told about) against Google not
 * answering (which they cannot affect). Getting it wrong in either direction is
 * expensive — an unrepaired calendar stays broken, or a message that means "act
 * now" is spent on an outage and stops being read.
 */

// Hoisted: `lib/env.mjs` is read while the module under test is still being
// imported, so a plain const would not exist yet.
const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);

vi.mock('@/lib/env.mjs', () => ({
  get env() {
    return envMock;
  },
}));

import {
  classifyGoogleTokenFailure,
  needsReconnect,
  reconnectUrl,
  GoogleAccessError,
} from '@/lib/auth/google-access';

/** What google-auth-library throws: a Gaxios error carrying the OAuth body. */
function gaxios(status: number, body: Record<string, unknown>, message = 'Request failed') {
  return Object.assign(new Error(message), { response: { status, data: body } });
}

beforeEach(() => {
  for (const key of Object.keys(envMock)) delete envMock[key];
});

describe('reading a failed refresh', () => {
  it('treats invalid_grant as the permission having ended', () => {
    expect(
      classifyGoogleTokenFailure(
        gaxios(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      )
    ).toBe('expired');
  });

  it('finds invalid_grant in the message when the body is not parsed', () => {
    expect(classifyGoogleTokenFailure(new Error('invalid_grant'))).toBe('expired');
  });

  /**
   * The deployment's own credentials being wrong is not the user's to fix. Told
   * to reconnect, they would grant consent, arrive back at the same message,
   * and have been blamed twice for someone else's env var.
   */
  it('does not blame the user for a misconfigured client', () => {
    expect(classifyGoogleTokenFailure(gaxios(401, { error: 'invalid_client' }))).toBe('unavailable');
    expect(classifyGoogleTokenFailure(gaxios(400, { error: 'unauthorized_client' }))).toBe(
      'unavailable'
    );
  });

  it('reads an outage or a timeout as "could not tell"', () => {
    expect(classifyGoogleTokenFailure(gaxios(503, {}))).toBe('unavailable');
    expect(classifyGoogleTokenFailure(new Error('ETIMEDOUT'))).toBe('unavailable');
    expect(classifyGoogleTokenFailure(undefined)).toBe('unavailable');
  });
});

describe('who has to do something about it', () => {
  it('is the user only when the permission itself is gone', () => {
    expect(needsReconnect('expired')).toBe(true);
    expect(needsReconnect('missing')).toBe(true);
    expect(needsReconnect('unavailable')).toBe(false);
    expect(needsReconnect('ok')).toBe(false);
  });
});

describe('where the repair lives', () => {
  it('prefers APP_URL and strips a trailing slash', () => {
    envMock.APP_URL = 'https://assistant.example.com/';
    envMock.NEXTAUTH_URL = 'http://localhost:3000';

    expect(reconnectUrl()).toBe('https://assistant.example.com/settings#google');
  });

  it('falls back to NEXTAUTH_URL', () => {
    envMock.NEXTAUTH_URL = 'https://app.example.com';

    expect(reconnectUrl()).toBe('https://app.example.com/settings#google');
  });

  // A bare path in a Telegram message is not an address, so the callers say it
  // in words instead of linking to nothing.
  it('is null when the deployment does not know its own origin', () => {
    expect(reconnectUrl()).toBeNull();
  });
});

describe('the error a calendar tool throws', () => {
  it('tells the model what to say, including where to send the user', () => {
    const error = new GoogleAccessError();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('/google');
    expect(error.message).toContain('Settings → Google');
    // The one answer this must never turn into.
    expect(error.message).toContain('Never answer this by saying the day is free');
  });
});
