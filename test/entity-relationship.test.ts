import { describe, expect, it } from 'vitest';

import { normalizeRelationship, pickRelationship } from '@/lib/entities/relationship';

/**
 * Who someone is *to the user*.
 *
 * `entities.relationship` is the one thing on an entity page that is a claim
 * rather than evidence, and extraction gets it wrong in a specific way: a note
 * stating how two other people relate ("Артем — похресник моєї куми") has that
 * relation lifted out of its sentence and filed against the user, so a son is
 * recorded as a godson. The correction has to outlive the next mention, which
 * is what `relationship_source` is for.
 */

describe('normalizeRelationship', () => {
  it('keeps one tidy phrase', () => {
    expect(normalizeRelationship('  син   користувача ')).toBe('син користувача');
  });

  // Blank is the answer to "godson" being wrong when no other word is right.
  // Reading it as "no opinion" would hand the field back to the reading being
  // overruled, and the next note would write "похресник" again.
  it('treats an empty answer as an answer, not a missing one', () => {
    expect(normalizeRelationship('')).toBeNull();
    expect(normalizeRelationship('   ')).toBeNull();
  });
});

describe('pickRelationship', () => {
  const model = (relationship: string | null) => ({ relationship, relationshipSource: 'model' });
  const user = (relationship: string | null) => ({ relationship, relationshipSource: 'user' });

  it('keeps the winner when neither side was set by hand', () => {
    expect(pickRelationship(model('colleague'), model('friend'))).toEqual(model('colleague'));
  });

  it('lets the loser fill a blank the winner never had', () => {
    expect(pickRelationship(model(null), model('friend'))).toEqual(model('friend'));
  });

  // Which of two duplicates survives is decided by mention count — something the
  // user never sees and never chose. If they have said who somebody is, that
  // answer cannot depend on which row the model wrote more notes about.
  it('takes the hand-set relationship from the losing side', () => {
    expect(pickRelationship(model('godson'), user('son'))).toEqual(user('son'));
  });

  it('does not let the model overrule a hand-set one on the winning side', () => {
    expect(pickRelationship(user('son'), model('godson'))).toEqual(user('son'));
  });

  // The deliberately emptied case: keyed on the source, so "they are nothing in
  // particular to me" survives a merge exactly as a typed word does.
  it('carries a deliberately empty answer through', () => {
    expect(pickRelationship(model('godson'), user(null))).toEqual(user(null));
  });

  it('gives two hand-set values to the survivor the user confirmed', () => {
    expect(pickRelationship(user('son'), user('godson'))).toEqual(user('son'));
  });
});
