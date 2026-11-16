// Public list prices, so the band can say what the cache costs.

export interface Price {
  input: number
  output: number
  write5m: number
  write1h: number
  cacheRead: number
}

const price = (input: number, write5m: number, write1h: number, cacheRead: number, output: number): Price => ({ input, write5m, write1h, cacheRead, output })

const HAIKU_LARGE_PROMPT = 100_000
const HAIKU_LARGE = price(0.5, 0.625, 1, 0.05, 2.5)

// USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing on 2026-11-02.
// shortcut: fast mode and US-only inference are priced as standard, add them when a report needs them.
const PRICES: [string, Price][] = (
  [
    ['claude-fable-5-1', price(10, 12.5, 20, 0.25, 50)],
    ['claude-mythos-5-1', price(10, 12.5, 20, 0.25, 50)],
    ['claude-fable-5', price(10, 12.5, 20, 1, 50)],
    ['claude-mythos-5', price(10, 12.5, 20, 1, 50)],
    ['claude-opus-5-5', price(4, 5, 8, 0.2, 20)],
    ['claude-opus-5', price(5, 6.25, 10, 0.5, 25)],
    ['claude-opus-4-8', price(5, 6.25, 10, 0.5, 25)],
    ['claude-opus-4-7', price(5, 6.25, 10, 0.5, 25)],
    ['claude-opus-4-6', price(5, 6.25, 10, 0.5, 25)],
    ['claude-opus-4-5', price(5, 6.25, 10, 0.5, 25)],
    ['claude-sonnet-5-5', price(2, 2.5, 4, 0.1, 10)],
    ['claude-sonnet-5', price(2, 2.5, 4, 0.2, 10)],
    ['claude-sonnet-4-6', price(3, 3.75, 6, 0.3, 15)],
    ['claude-sonnet-4-5', price(3, 3.75, 6, 0.3, 15)],
    ['claude-haiku-5-5', price(0.1, 0.125, 0.2, 0.01, 0.5)],
    ['claude-haiku-4-5', price(1, 1.25, 2, 0.1, 5)],
  ] as [string, Price][]
).sort((a, b) => b[0].length - a[0].length)

// `opus[1m]` is opus with a larger window, and a Bedrock or Vertex id wraps the model's own (`us.anthropic.claude-…`, `claude-…@date`).
export function listId(id: string): string {
  const bare = id.replace(/\[[^\]]*\]$/, '')
  return bare.includes('claude-') ? bare.slice(bare.indexOf('claude-')) : bare
}

/** A model's public list price, or null when this table does not know it. A dated or wrapped id finds its model. */
export function priceOf(id: string, prompt: number): Price | null {
  const model = listId(id)
  const found = PRICES.find(([prefix]) => model.startsWith(prefix))?.[1] ?? null
  return found && model.startsWith('claude-haiku-5-5') && prompt > HAIKU_LARGE_PROMPT ? HAIKU_LARGE : found
}
