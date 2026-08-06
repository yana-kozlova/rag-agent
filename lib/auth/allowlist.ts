/**
 * Who is allowed to have an account here.
 *
 * Google OAuth proves who someone is, which is not the same as deciding they
 * belong: without a gate, anyone who finds the URL signs in, gets their own
 * knowledge base, and spends the owner's OpenAI and Groq budget doing it. That
 * matters more than it looks, because the Telegram bot inherits this decision —
 * `/start <code>` can only be redeemed by someone who already has an account,
 * so this list is the only door in the building.
 *
 * An unset list means open, and deliberately so: this app was deployed open,
 * and failing closed on an empty value would lock the owner out of their own
 * instance on the very deploy that added the check. Production says so out loud
 * instead.
 *
 * Kept free of imports so the rule can be tested without a database, an env
 * module or a NextAuth runtime.
 */

/** `a@b.com, @team.com` → `['a@b.com', '@team.com']`, lowercased. */
export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * An entry is either a whole address or, when it starts with `@`, a domain —
 * `@example.com` admits everyone at that company without listing them.
 */
export function isEmailAllowed(
  email: string | undefined | null,
  raw: string | undefined | null
): boolean {
  const entries = parseAllowlist(raw);
  if (entries.length === 0) return true;

  const address = email?.trim().toLowerCase();
  // A list that names addresses cannot admit an account that has none.
  if (!address) return false;

  const at = address.lastIndexOf('@');
  const domain = at === -1 ? null : address.slice(at);

  return entries.some((entry) => (entry.startsWith('@') ? entry === domain : entry === address));
}

let warned = false;

/**
 * Say once, in production, that the instance is open to the world. A warning
 * per sign-in would scroll the fact out of the logs; a warning per boot is
 * exactly the number of times someone can act on it.
 */
export function warnIfOpen(raw: string | undefined | null): void {
  if (warned || process.env.NODE_ENV !== 'production') return;
  if (parseAllowlist(raw).length > 0) return;

  warned = true;
  console.warn(
    '[auth] ALLOWED_EMAILS is unset — any Google account can sign in and use this deployment.'
  );
}
