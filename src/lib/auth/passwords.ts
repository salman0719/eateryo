/**
 * Password rules (P2) — settled in the password prototype, enforced
 * server-side on every set/change. Framework-free on purpose: the
 * set-password screen imports the checklist from this same module, so the
 * client feedback and the server gate can never disagree about the rules.
 *
 * Rules: 10 characters or more, not the address (or its local part), not a
 * commonly used password. No character-class rules — the strength score is
 * feedback, never the gate. Hashing stays the auth library's default
 * (scrypt); this module never sees a hash.
 */

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * The prototype's denylist, verbatim. Short notorious passwords cannot pass
 * the length rule anyway; these are the ≥10-character ones attackers try
 * first. Live breach checks are hardening (§12), not this step.
 */
const COMMON_PASSWORDS = new Set([
  "password12",
  "password123",
  "12345678910",
  "qwertyuiop",
  "eateryo123",
  "letmein12345",
  "iloveyou12",
  "welcome1234",
]);

export interface PasswordRuleStatus {
  longEnough: boolean;
  notEmail: boolean;
  notCommon: boolean;
}

/** Per-rule status for the set-password checklist. */
export function passwordRuleStatus(password: string, email: string): PasswordRuleStatus {
  const lower = password.toLowerCase();
  const address = email.trim().toLowerCase();
  const local = address.split("@")[0] ?? "";
  return {
    longEnough: password.length >= MIN_PASSWORD_LENGTH,
    notEmail: password.length > 0 && lower !== address && (local === "" || lower !== local),
    notCommon: password.length > 0 && !COMMON_PASSWORDS.has(lower),
  };
}

/**
 * The one server gate: the settled message for the first failing rule, or
 * null when the password may be set. Order matches the prototype — length,
 * then email, then common, then confirmation.
 */
export function validateNewPassword(
  password: string,
  confirmation: string,
  email: string
): string | null {
  if (password.length > MAX_PASSWORD_LENGTH) return "Use at most 128 characters.";
  const checks = passwordRuleStatus(password, email);
  if (!checks.longEnough) return "Use at least 10 characters.";
  if (!checks.notEmail) return "Your password can't be your email address.";
  if (!checks.notCommon) return "That password is too common. Choose another.";
  if (password !== confirmation) return "The two passwords don't match.";
  return null;
}

/**
 * Strength feedback for the meter (0–4), never the gate — the prototype's
 * scoring, kept here so the bar means the same everywhere it renders.
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;
  return score as 0 | 1 | 2 | 3 | 4;
}
