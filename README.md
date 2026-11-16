<p align="center">
  <img src=".github/assets/icon.svg" width="96" height="96" alt="canon-band icon">
</p>

<h1 align="center">canon-band</h1>

<p align="center"><b>Your usage under the Claude Code prompt, short replies, and a yes before anything risky.</b></p>

canon-band is a Claude Code mod. It adds no skills, no startup text and no server.

```
                                    ☼  assisted  S  ⓘ  ↻ 53m +$0.17
╭──────────────────────────────────────────────────────────────────╮
│ > your prompt                                                    │
╰──────────────────────────────────────────────────────────────────╯
  ? for shortcuts · $1.20 · 7D 59% · 5H 4% · ctx 23k
```

## Under the prompt

- **Cost:** what this session has spent.
- **7D and 5H:** how much of your 7-day and 5-hour limits you have used, from 0%.
- **ctx:** the tokens in the context window, from the moment the session loads.

## Above the prompt

- **☼ Awake:** a click turns it into a green ☀ that keeps this Mac and its screen awake while the session is open.
- **Mode:** `assisted` or `manual`. In assisted, when Claude recommends something, a **Go with it** button sends it on.
- **Reply size:** S (the default), M or L. Every reply is in plain words, the way a person talks. It goes beside each prompt you type, so the cache holds.
- **ⓘ:** the cost, usage with reset times, and what fills the context: system prompt, tools, memory, messages and what is free.
- **Prompt cache:** how long it stays warm. One click keeps it warm for another hour, and the label shows the cost first. Once cold, it shows what your next message costs.

The same row shows what needs you, one thing at a time:

```
Claude wants to run a push: git push origin main    [Allow once]  [Block]
Claude recommends: rename the repo                  [Go with it]  [Not now]
7D 91% used, resets in 3d 9h
```

## A yes before anything risky

In every mode, these wait for **Allow once**: deletes (`rm -r`, `git reset --hard`,
`git clean -f`, `branch -D`, dropping a table, a database reset), any `git push`,
deploys and store submits, publishing a package or release, changing who can see
a repo, live money commands, and reading a secret (`.env`, keys, `local/secrets`).
Allow once lets that exact command run one time.

Only your own sessions are guarded. Headless runs (Archon, `claude -p`) are left to
their own hooks, and only prompts you type get the reply rule.

## Install

```bash
claude plugin marketplace add ritesh-firodiya/canon-band
claude plugin install canon-band@canon-band
```

Coming from `canon`: `claude plugin uninstall canon@canon` first. The rest of
canon moved into Babul ([github.com/babulhq/babul](https://github.com/babulhq/babul)).

## Develop

The mod is a Claude Code hooks module in `hooks/band/`. Run its tests with
`pnpm test` (it runs `claude plugin test .`).

Cache and usage logic follow ribbon (MIT, robonuggets/ribbon).

MIT licence.
