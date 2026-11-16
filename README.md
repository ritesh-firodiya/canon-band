<p align="center">
  <img src=".github/assets/icon.svg" width="96" height="96" alt="canon-band icon">
</p>

<h1 align="center">canon-band</h1>

<p align="center"><b>Your Claude Code usage above the prompt, and short plain replies.</b></p>

canon-band is a Claude Code mod. It adds no skills, no system prompt text and no
server. The only thing it sends is a short note beside each prompt you type,
about 75 tokens, with your reply size.

```
☼  $1.20  S  opus  high            3d 59%  2h 4%  ctx 23k  ↻ 53m +$0.17
╭──────────────────────────────────────────────────────────────────────────╮
│ > your prompt                                                            │
╰──────────────────────────────────────────────────────────────────────────╯
```

One row above the prompt, two on a narrow terminal. Click any item and it says
what it means in one line, which closes by itself.

- **☼ Awake:** a click turns it into a green ☀ that keeps this Mac and its screen awake while the session is open. macOS only.
- **Cost:** what this session has spent.
- **Reply size:** S (the default), M or L. S is one to three short lines, M the answer and a short list, L the answer with steps and trade-offs. Every size asks for plain words, the way a person talks.
- **Model:** the family the session runs (`fable`, `opus`, `sonnet`, `haiku`). A click opens a row with the others, each with what the next message costs, since a switch reloads the whole chat into the new model's cache. A pick runs `/model`.
- **Effort:** how hard the model thinks. A click goes low, medium, high, xhigh, max and round, and each main request carries it. The cache holds. Before the first reply it shows `effort`, meaning the model's own default.
- **Weekly and 5-hour limits:** `3d 59%` is 3 days until the weekly limit resets, with 59% of it used; `2h 4%` the same for the 5-hour limit. Usage counts up from 0%: amber from 60%, red from 80%. A click gives the exact reset time. Shown on a Claude plan, once the first reply comes back.
- **Spend limit:** when a Claude gateway reports your company's spend limit, it shows the same way, `12d 41%`, and follows the limit when an admin changes it.
- **This month:** off a Claude plan (Bedrock, Vertex, an API key), `Nov $212` is what this Mac has spent this month in sessions with canon-band. Set **Monthly limit (USD)** in the plugin settings (`/plugin`, then canon-band) and it shows `Nov $212/$1000`, amber from 60% and red from 80%. It counts this Mac only, not other machines or people, and a limit that changes has to be changed there too.
- **ctx:** the tokens in the context window, from the moment the session loads (Claude Code's own estimate, then each reply). A click shows what fills it, largest first: system prompt, tools, memory, messages, then what is free.
- **Prompt cache:** `↻ 53m` is how long it stays warm. A click keeps it warm for another hour, and the label shows that cost first. Once cold, `◌ cold ~$8.00` is what your next message costs.

Reply size starts over in each new session.

Only prompts you type get the reply note. Headless runs (Archon, `claude -p`,
the SDK), schedules and other agents are left alone.

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
hooks, `facts.ts` holds the pure logic and `prices.ts` the public list prices that price the cache. Run the tests with
`pnpm test` (it runs `claude plugin test .`).

Cache and usage logic follow ribbon (MIT, robonuggets/ribbon).

MIT licence.
