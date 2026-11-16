// Critical operations: each needs the person's yes, in every mode. Pure, so the tests call it directly.

export interface Risk {
  /** What it is, in plain words: "a push". */
  what: string
  pattern: RegExp
}

// One list for Bash commands, matched anywhere in the command, so `cd x && git push` is caught too.
export const COMMAND_RISKS: readonly Risk[] = [
  { what: 'a delete', pattern: /\brm\s+(-\w*[rR]\w*|--recursive)\b/ },
  { what: 'a delete', pattern: /\bgit\s+(reset\s+--hard|clean\s+-\w*f\w*|branch\s+-D|filter-repo)\b/ },
  { what: 'a delete', pattern: /\b(drop|truncate)\s+(table|database|schema)\b/i },
  { what: 'a delete', pattern: /\b(prisma\s+migrate\s+reset|supabase\s+db\s+reset|drizzle-kit\s+drop)\b/ },
  { what: 'a push', pattern: /\bgit\s+push\b/ },
  { what: 'a deploy', pattern: /\b(vercel\s+(deploy|--prod)|netlify\s+deploy|firebase\s+deploy|fly\s+deploy|wrangler\s+(deploy|publish)|eas\s+(submit|update)|fastlane)\b/ },
  { what: 'a release', pattern: /\b((npm|pnpm|yarn)\s+(publish|unpublish|deprecate)|gh\s+release\s+create)\b/ },
  { what: 'a visibility change', pattern: /\bgh\s+repo\s+(delete|rename|archive|edit\b.*--visibility)\b/ },
  { what: 'a money command', pattern: /\bstripe\b.*--live\b/ },
  { what: 'reading a secret', pattern: /(^|[\s'"=/])(\.env(\.(?!example\b)[\w-]+)?|[\w-]+\.(p8|p12|pem|jks|keystore|mobileprovision)|id_(rsa|ed25519)|credentials\.json)(?=$|[\s'"])/ },
  { what: 'reading a secret', pattern: /\blocal\/secrets\b/ },
]

const SECRET_FILE = /(^|\/)(\.env(\.(?!example$)[\w-]+)?|[\w-]+\.(p8|p12|pem|jks|keystore|mobileprovision)|id_(rsa|ed25519)|credentials\.json)$|\/local\/secrets\//

/** What makes a command critical, or null when it is not. */
export const commandRisk = (command: string): string | null => COMMAND_RISKS.find(r => r.pattern.test(command))?.what ?? null

/** Reading a key or an .env file is critical too. */
export const readRisk = (path: string): string | null => (SECRET_FILE.test(path) ? 'reading a secret' : null)
