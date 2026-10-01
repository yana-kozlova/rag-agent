---
paths:
  - "lib/directives/**"
  - "lib/actions/directives.ts"
  - "lib/db/schema/directives.ts"
  - "lib/ai/tools/directives/**"
  - "lib/ai/agent.ts"
  - "app/api/directives/**"
  - "app/settings/ResponsePreferences.tsx"
  - "test/directive*"
---

# Response preferences

**These are prepended, not retrieved, and that is the whole point.** Preferences were already storable: `addResource` classifies them as `metadata.type: 'preference'` and embeds them, and the system prompt tells it to do so proactively. But a resource only surfaces when `getInformation` searches for it, and nothing searches before answering "що в мене завтра?" — so "відповідай коротше" sat in the knowledge base being perfectly findable and never once applied. `assistant_directives` rows go into the system prompt on every turn instead, which is why they need a bounded, listable home rather than a flag on a resource: a note is prose that is inert until something matches it, a directive runs on every request across both surfaces and a wrong one degrades every answer invisibly.

`agentOptions()` is async for this reason — the system prompt is now per-user. Building it there rather than at each entry point is what makes a preference set in the web chat hold in Telegram without either surface knowing the feature exists. A failed read degrades to an empty block rather than throwing: a lost preference costs tone on one reply, an exception costs the reply.

`MAX_DIRECTIVES` (20) and `MAX_DIRECTIVE_LENGTH` (200) are the difference between a preference memory and a slowly rotting system prompt — these compete with the user's actual question for attention, and long rules are the ones that contradict each other. Hitting the cap is reported to the model, never resolved by evicting the oldest: the user typed each of these. The length cap is in zod *and* as a SQL CHECK, on the wellbeing precedent. Both constants live in `lib/directives/directives.ts` rather than beside the column, because the settings panel is a client component (same reason as `lib/wellbeing/scale.ts`).

Editing is in place and settings-only. Delete-then-add would be equivalent except for order, and order is not decoration here — the list is rendered oldest-first into the prompt, so retyping a rule to fix one clause would silently send it to the bottom. It is also the common repair: a standing instruction is usually right except for being one word too broad. The duplicate check excludes the row being edited, or every edit would be rejected as already saved. An edited directive always becomes `user`-sourced whatever it was before — once someone rewrites the model's reading of their habit, the "you didn't ask for this" badge would be a lie. No tool for it: the chat repairs a rule by dropping it and stating the new one, which is the same two sentences a person says anyway and does not need the model resolving "change the third one" against a list it cannot address by id.

Deleting is by description, not by id: quoting an id back would mean rendering nanoids into every prompt to serve the rarest action. The price is `matchDirective`, which shares its similarity function with the duplicate check — so "that's the same instruction" and "that's the instruction you meant" can never disagree — and returns `ambiguous` rather than a best guess, because dropping the wrong standing rule is the one failure here nobody notices at the time. Near-duplicate detection is deliberately dumber than the symptom matcher: symptoms are matched blind and charted, directives top out at twenty on a settings screen where a survivor is one click from gone.

The block renders *below* the assistant's own rules and says in as many words that preferences never override them. Directives arrive through a tool the model can call itself, so nothing must be able to talk its way into switching off the medical or confirm-before-writing rules. `source` (`user` | `inferred`) exists only for the settings screen — both are followed identically, but an inferred rule is the model's reading of a repeated correction, and someone puzzled by an answer needs to see that they never asked for it.
