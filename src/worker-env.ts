/**
 * Names that must not be inherited by grok, claude, or codex.
 * Matches `*_API_TOKEN`, `*_TOKEN`, `*_PASSWORD`, and the same class of secret
 * (`SECRET`, `CREDENTIAL`, `ACCESS_KEY`, ...). Worker model keys named `*_API_KEY`
 * are left in place so the coding CLI can still authenticate.
 */
const SECRET_ENV_NAME =
  /API_TOKEN|(?:^|_)TOKEN$|PASSWORD|PASSWD|SECRET|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|SESSION_TOKEN/i;

export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_NAME.test(name);
}

export function scrubWorkerEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (isSecretEnvName(key)) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

/** Env names whose secret values appear in `text`. The values themselves are not returned. */
export function leakedSecretNames(text: string, source: NodeJS.ProcessEnv = process.env): string[] {
  const names: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (!isSecretEnvName(key) || typeof value !== "string" || value.length < 6) {
      continue;
    }
    if (text.includes(value)) {
      names.push(key);
    }
  }
  return names;
}
