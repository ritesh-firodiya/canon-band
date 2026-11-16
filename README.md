<p align="center">
  <img src=".github/assets/icon.svg" width="96" height="96" alt="canon icon">
</p>

<h1 align="center">canon</h1>

<p align="center"><b>See your usage and prompt cache above the Claude Code prompt.</b></p>

canon adds one band above the Claude Code prompt. It adds no skills, no startup
text and no server.

```
☼  $1.20                                      M  7D 59%  5H 4%  ctx 23k  ↻ 53m +$0.17
```

- **Awake:** ☼ is off. A click turns it into a green ☀ that keeps this Mac and its screen awake while the session is open.
- **Cost:** what this session has spent.
- **Reply size:** S, M or L. A click moves to the next size. It goes beside each prompt, so the cache holds.
- **Usage used** in your 7-day and 5-hour windows, rising from 0%, with the reset time when it runs high.
- **Context:** the tokens in the context window, from the moment the session loads. A click breaks them down: system prompt, tools, memory, messages and what is free.
- **Prompt cache:** how long it stays warm, and what your next message costs once it goes cold. One click restarts the hour; the label shows the cost first.
- **Click to see what it means:** each short item explains itself in one line, which closes by itself.

The rest of canon moved into Babul ([github.com/babulhq/babul](https://github.com/babulhq/babul)).

## Install

```bash
claude plugin marketplace add ritesh-firodiya/canon-cli
claude plugin install canon@canon
```

## Develop

The band is a Claude Code hooks module in `hooks/band/`. Run its tests with
`pnpm test` (it runs `claude plugin test .`).

Cache and usage logic follow ribbon (MIT, robonuggets/ribbon).

MIT licence.
