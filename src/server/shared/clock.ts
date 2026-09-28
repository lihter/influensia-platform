/**
 * Clock injection (SPEC F-28). Every service takes "now" from here so seeding and tests can pin time.
 * Precedence: explicit override (tests) > SEED_CLOCK env > wall clock.
 */
let override: Date | null = null;

export function now(): Date {
  if (override) return new Date(override);
  const env = process.env.SEED_CLOCK;
  if (env) {
    const d = new Date(env);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Tests/seed only. Pass null to clear. */
export function setClock(d: Date | string | null) {
  override = d === null ? null : new Date(d);
}

/** ISO date (yyyy-mm-dd) of `now()` in UTC. */
export function today(): string {
  return now().toISOString().slice(0, 10);
}
