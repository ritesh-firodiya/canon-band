<p align="center">
  <img src=".github/assets/icon.svg" width="96" height="96" alt="canon-band icon">
</p>

<h1 align="center">canon-band</h1>

<p align="center"><b>Your Claude Code usage above the prompt, short plain replies, and a yes before anything risky.</b></p>

canon-band is a Claude Code mod. It adds no skills, no system prompt text and no
server. The only thing it sends is a short note beside each prompt you type,
about 75 tokens, with your reply size and mode.

```
☼  $1.20  assisted  S                     7D 59%  5H 4%  ctx 23k  ↻ 53m +$0.17
╭──────────────────────────────────────────────────────────────────────────╮
│ > your prompt                                                            │
╰──────────────────────────────────────────────────────────────────────────╯
```

One row above the prompt, two on a narrow terminal. Click any item and it says
what it means in one line, which closes by itself.

- **☼ Awake:** a click turns it into a green ☀ that keeps this Mac and its screen awake while the session is open. macOS only.
- **Cost:** what this session has spent.
- **Mode:** `assisted` (the default) or `manual`. In assisted, Claude ends a choice with a `Recommend:` line, and a **Go with it** button sends it on. Manual adds no button.
- **Reply size:** S (the default), M or L. S is one to three short lines, M the answer and a short list, L the answer with steps and trade-offs. Every size asks for plain words, the way a person talks.
- **7D and 5H:** how much of your 7-day and 5-hour limits you have used, from 0%. Amber from 60%, red from 80% with the reset time. Shown on a Claude plan, once the first reply comes back.
- **ctx:** the tokens in the context window, from the moment the session loads (Claude Code's own estimate, then each reply). A click shows what fills it, largest first: system prompt, tools, memory, messages, then what is free.
- **Prompt cache:** `↻ 53m` is how long it stays warm. A click keeps it warm for another hour, and the label shows that cost first. Once cold, `◌ cold ~$8.00` is what your next message costs.

What needs you gets its own row above the band, one thing at a time:

```
Claude wants to run a push: git push origin main    [Allow once]  [Block]
Claude recommends: rename the repo                  [Go with it]  [Not now]
```

Mode and reply size start over in each new session.

## A yes before anything risky

In every mode, these wait for **Allow once**:

- **Deletes:** `rm -r`, `git reset --hard`, `git clean -f`, `git branch -D`, `git filter-repo`, dropping or truncating a table, database or schema, and a database reset (Prisma, Supabase, Drizzle).
- **Pushes:** any `git push`.
- **Deploys and store submits:** Vercel, Netlify, Firebase, Fly, Wrangler, EAS submit or update, fastlane.
- **Releases:** `npm`, `pnpm` or `yarn` publish, unpublish or deprecate, and `gh release create`.
- **Repo changes:** `gh repo` delete, rename, archive or a visibility change.
- **Money:** `stripe` commands with `--live`.
- **Secrets:** reading an `.env` file (not `.env.example`), a key file (`.p8`, `.p12`, `.pem`, `.jks`, `.keystore`, `.mobileprovision`, `id_rsa`, `id_ed25519`, `credentials.json`) or anything under `local/secrets`, by a command or by Claude's Read tool.

**Allow once** lets that exact command run one time, and tells Claude to run it again.
**Block** tells Claude not to run it.

It is a safety net, not a sandbox. It matches shell commands and file reads by
pattern. Edits, MCP tools and a command written to avoid the pattern get past it.

Only your own sessions are guarded, and only prompts you type get the reply note.
Headless runs (Archon, `claude -p`, the SDK), schedules and other agents are left alone.

## Install

```bash
claude plugin marketplace add ritesh-firodiya/canon-band
claude plugin install canon-band@canon-band
```

Coming from `canon`: run `claude plugin uninstall canon@canon` first. The rest of
canon (rules, knowledge, checks and standards) moved into
[Babul](https://github.com/babulhq/babul).

## Develop

The mod is a Claude Code hooks module in `hooks/band/`: `register.tsx` draws and
hooks, `facts.ts` holds the pure logic, `guard.ts` the list of risky operations
and `prices.ts` the public list prices that price the cache. Run the tests with
`pnpm test` (it runs `claude plugin test .`).

Cache and usage logic follow ribbon (MIT, robonuggets/ribbon).

MIT licence.
