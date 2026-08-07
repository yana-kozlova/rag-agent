import { describe, expect, it } from 'vitest';

import {
  DUPLICATE_THRESHOLD,
  MAX_DIRECTIVES,
  MAX_DIRECTIVE_LENGTH,
  directiveSimilarity,
  findDuplicate,
  matchDirective,
  normalizeDirective,
  renderDirectives,
} from '@/lib/directives/directives';

const d = (text: string) => ({ id: text, text });

describe('normalizeDirective', () => {
  it('folds the differences that are only typing', () => {
    expect(normalizeDirective('  Відповідай   коротше.  ')).toBe('Відповідай коротше');
    expect(normalizeDirective('Answer in Ukrainian!')).toBe('Answer in Ukrainian');
  });

  it('keeps case, because the rule is shown back to the user as written', () => {
    expect(normalizeDirective('Answer in Ukrainian')).toBe('Answer in Ukrainian');
  });
});

describe('directiveSimilarity', () => {
  it('scores a re-punctuated restatement as the same rule', () => {
    expect(directiveSimilarity('Відповідай коротше', 'відповідай коротше!')).toBe(1);
  });

  it('keeps unrelated rules well apart', () => {
    const score = directiveSimilarity('Answer in Ukrainian', 'Never suggest follow-up questions');
    expect(score).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it('is 0 when either side has no words', () => {
    expect(directiveSimilarity('', 'Answer in Ukrainian')).toBe(0);
  });
});

describe('findDuplicate', () => {
  it('catches a rule the user already set, so the prompt holds one copy', () => {
    const existing = [d('Answer in Ukrainian unless I write in English')];
    expect(findDuplicate('answer in Ukrainian unless I write in English.', existing)).toBe(
      existing[0]
    );
  });

  it('lets a genuinely different rule through', () => {
    const existing = [d('Answer in Ukrainian')];
    expect(findDuplicate('Skip the preamble, lead with the answer', existing)).toBeNull();
  });

  it('does not call an edit a duplicate of the rule being edited', () => {
    // `updateDirective` excludes the row itself before calling this. Without
    // that, fixing one word in a rule would be rejected as already saved —
    // an edit is by definition near-identical to what it replaces.
    const target = d('Skip the preamble and lead with the answer');
    const others = [d('Answer in Ukrainian')];
    expect(findDuplicate('Skip the preamble and lead with the result', others)).toBeNull();
    expect(findDuplicate('Skip the preamble and lead with the result', [target, ...others])).toBe(
      target
    );
  });
});

describe('matchDirective', () => {
  const existing = [
    d('Answer in Ukrainian unless I write in English'),
    d('Skip the preamble and lead with the answer'),
    d('Never offer follow-up suggestions'),
  ];

  it('finds the rule a loose description refers to', () => {
    const match = matchDirective('skip the preamble', existing);
    expect(match.kind).toBe('one');
    expect(match.kind === 'one' && match.directive.text).toBe(
      'Skip the preamble and lead with the answer'
    );
  });

  it('reports nothing rather than deleting the closest thing', () => {
    expect(matchDirective('use metric units', existing).kind).toBe('none');
  });

  it('asks instead of guessing when two rules score the same', () => {
    const twins = [d('always answer briefly'), d('always answer concisely')];
    const match = matchDirective('always answer short', twins);
    expect(match.kind).toBe('ambiguous');
    expect(match.kind === 'ambiguous' && match.candidates).toHaveLength(2);
  });
});

describe('renderDirectives', () => {
  it('renders nothing at all when there are no preferences', () => {
    // The prompt splices this in directly — a heading with an empty list under
    // it reads to the model as "this user has explicitly set no preferences".
    expect(renderDirectives([])).toBe('');
  });

  it('lists every rule under one heading', () => {
    const block = renderDirectives([d('Answer in Ukrainian'), d('Skip the preamble')]);
    expect(block).toContain('## How this user wants you to respond');
    expect(block).toContain('- Answer in Ukrainian');
    expect(block).toContain('- Skip the preamble');
  });

  it('states that preferences do not override the rules above them', () => {
    // A directive arrives through a tool the model can call on its own, so the
    // framing is what stops a saved rule from switching off the medical or
    // confirm-before-writing rules earlier in the prompt.
    expect(renderDirectives([d('Answer in Ukrainian')])).toContain('never override');
  });
});

describe('the prompt slot', () => {
  it('exists, and sits below the assistant\'s own rules', async () => {
    const { SYSTEM_PROMPT } = await import('@/app/prompts/system');

    expect(SYSTEM_PROMPT).toContain('{DIRECTIVES}');
    // Order is load-bearing: a user preference must read as an addition to the
    // rules, not as a later instruction superseding them.
    expect(SYSTEM_PROMPT.indexOf('{DIRECTIVES}')).toBeGreaterThan(
      SYSTEM_PROMPT.indexOf('## Critical rules')
    );
  });
});

describe('caps', () => {
  it('keeps the list short enough to stay in front of the question', () => {
    expect(MAX_DIRECTIVES).toBeLessThanOrEqual(25);
    expect(MAX_DIRECTIVE_LENGTH).toBeLessThanOrEqual(300);
  });
});
