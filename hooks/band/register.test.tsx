import { expect, mock, test } from 'claude-code/testing'

import { breakdownLine, cacheView, canExtend, coldLabel, contextView, extendLabel, infoLine, isNarrow, isTyped, nextSize, replyRule, tokens, windowViews } from './facts'
import { priceOf } from './prices'

const OPUS = 'claude-opus-5-5'
const render = (surface: 'terminal' | 'desktop', columns = 140, isWorking = false) =>
  ({ plugin: 'canon', component: 'AbovePrompt', surface, props: { hasSurvey: false, isWorking, maxRows: 12, bodyColumns: columns, scroll: { offset: 0, bodyRows: 12 }, view: {} } }) as const

const NOW = Date.parse('2026-11-02T10:00:00Z')

const ROWS = [
  { name: 'System prompt', tokens: 3_100, kind: 'used' },
  { name: 'System tools', tokens: 14_200, kind: 'used' },
  { name: 'Messages', tokens: 6_000, kind: 'used' },
  { name: 'MCP tools', tokens: 9_000, kind: 'deferred' },
  { name: 'Free space', tokens: 143_700, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
] as const
const BREAKDOWN = { categories: ROWS.map(r => ({ ...r, color: 'inactive', isDeferred: r.kind === 'deferred' })), totalTokens: 23_300, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: 12 }

function engine(on: any, frozen = false) {
  on('env.get', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w/shop' }))
  on('session.model', () => ({ value: OPUS }))
  // Before the first reply: no live reading, only the local estimate.
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 200_000, breakdown: BREAKDOWN } } }))
  mock.store(on)
  if (!frozen) return mock.clock(on)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
}

test('the cache is warm for an hour, and each state prices what it costs', () => {
  const warm = cacheView({ lastAt: 1_000_000, tokens: 1_000_000, model: OPUS }, 1_000_000 + 7 * 60000)
  expect(warm).toEqual({ mode: 'warm', minutesLeft: 53, extendUsd: 0.2 })
  const cold = cacheView({ lastAt: 1_000_000, tokens: 1_000_000, model: OPUS }, 1_000_000 + 60 * 60000)
  expect(cold).toEqual({ mode: 'cold', nextUsd: 8 })
  expect(extendLabel(53, 0.2)).toBe('↻ 53m +$0.20')
  expect(coldLabel(8)).toBe('◌ cold ~$8.00')
})

test('with nothing cached, or an unknown model, nothing false is shown', () => {
  expect(cacheView(null, 1)).toBeNull()
  expect(cacheView({ lastAt: 0, tokens: 5, model: OPUS }, 1)).toBeNull()
  expect(cacheView({ lastAt: 1, tokens: 5, model: 'new-model' }, 2)).toEqual({ mode: 'warm', minutesLeft: 60, extendUsd: null })
  expect(extendLabel(5, null)).toBe('↻ 5m')
  expect(extendLabel(5, 0.001)).toBe('↻ 5m +<$0.01')
})

test('a wrapped or dated id finds its price, and an unknown one has none', () => {
  expect(priceOf('us.anthropic.claude-haiku-4-5-20251001-v1:0', 0)?.input).toBe(1)
  expect(priceOf('claude-opus-5-5[1m]', 0)?.cacheRead).toBe(0.2)
  expect(priceOf('claude-haiku-5-5', 200_000)?.input).toBe(0.5)
  expect(priceOf('acme-small-1', 0)).toBeNull()
})

test('extend shows only on a warm cache with no reply running', () => {
  const warm = { mode: 'warm', minutesLeft: 5, extendUsd: 0.1 } as const
  expect(canExtend(warm, false)).toBe(true)
  expect(canExtend(warm, true)).toBe(false)
  expect(canExtend({ mode: 'cold', nextUsd: 1 }, false)).toBe(false)
  expect(canExtend(null, false)).toBe(false)
})

test('usage shows what is used, rising from 0: red from 80% with the reset only then, amber from 60%', () => {
  const now = Date.parse('2026-11-02T00:00:00Z')
  const views = windowViews(
    [
      { kind: 'five_hour', percentUsed: 65 },
      { kind: 'seven_day', percentUsed: 91, resetsAt: '2026-11-05T09:00:00Z' },
      { kind: 'other', percentUsed: 1 },
    ],
    now,
  )
  expect(views).toEqual([
    { name: '7D', used: 91, reset: '3d 9h', label: '7D 91% 3d 9h', level: 'bad' },
    { name: '5H', used: 65, reset: null, label: '5H 65%', level: 'warn' },
  ])
})

test('the context shows the tokens used, coloured by its share of the window', () => {
  expect(contextView({ tokens: 23_300, window: 200_000, percent: 12 })).toMatchObject({ label: 'ctx 23k', level: 'ok' })
  expect(contextView({ tokens: 176_000, window: 200_000, percent: 88 })).toMatchObject({ label: 'ctx 176k', level: 'bad' })
  expect(contextView(null)).toBeNull()
  expect([tokens(850), tokens(8_400), tokens(23_300), tokens(1_000_000), tokens(1_250_000)]).toEqual(['850', '8.4k', '23k', '1M', '1.3M'])
})

test('the breakdown lists what fills the window, largest first, then what is free', () => {
  expect(breakdownLine(ROWS)).toBe('System tools 14k · Messages 6k · System prompt 3.1k · Free space 144k · Autocompact buffer 33k')
})

test('reply size goes S, M, L and round, and each size tells the model what to write', () => {
  expect([nextSize('S'), nextSize('M'), nextSize('L')]).toEqual(['M', 'L', 'S'])
  expect(replyRule('S')).toContain('one to three lines')
  expect(replyRule('L')).toContain('trade-offs')
})

test('slash commands and messages from a mod do not carry the reply size', () => {
  expect(isTyped('why?', false)).toBe(true)
  expect(isTyped('/clear', false)).toBe(false)
  expect(isTyped('why?', true)).toBe(false)
  expect(isTyped('  ', false)).toBe(false)
})

test('a click on a short item says what it means in one line', () => {
  const base = { isAwake: false, size: 'M' as const, sessionUsd: 1.2, windows: windowViews([{ kind: 'seven_day', percentUsed: 91, resetsAt: '2026-11-05T09:00:00Z' }], Date.parse('2026-11-02T00:00:00Z')), context: contextView({ tokens: 80_000, window: 200_000, percent: 40 }), breakdown: null, cache: null }
  expect(infoLine('awake', base)).toContain('not keeping the Mac awake')
  expect(infoLine('awake', { ...base, isAwake: true })).toContain('will not sleep')
  expect(infoLine('size', base)).toContain('short bullet list')
  expect(infoLine('cost', base)).toBe('This session has spent $1.20.')
  expect(infoLine('7D', base)).toBe('7D: 91% of your weekly limit is used. It resets in 3d 9h.')
  expect(infoLine('5H', base)).toBe('5H: no reading yet.')
  expect(infoLine('ctx', base)).toBe('ctx: 80k of 200k tokens used (40%).')
  expect(infoLine('ctx', { ...base, breakdown: ROWS })).toContain('\nSystem tools 14k · Messages 6k')
})

test('a narrow terminal uses two rows', () => {
  expect(isNarrow(80)).toBe(true)
  expect(isNarrow(120)).toBe(false)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on ${surface}, the band draws the sun, the cost and the reply size`, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/w/shop', surface, isInteractive: true })
    const ui = await $.ui.mount(render(surface))
    expect(await ui.find({ type: 'Text', text: /☼/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$0\.00$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^M$/ })).toBeDefined()
    await ui.unmount()
  })
}

async function resumed($: any, on: any, secondsAway: number, sent: string[] = []) {
  engine(on, true)
  on('prompt.submit', (_: unknown, e: any) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: secondsAway, context_tokens: 1_000_000, model: OPUS })
}

test('a click on extend sends one tiny message', async ($, on) => {
  const sent: string[] = []
  await resumed($, on, 7 * 60, sent)
  const ui = await $.ui.mount(render('terminal'))
  expect(await ui.find({ type: 'Text', text: /↻ 53m \+\$0\.20/ })).toBeDefined()
  await ui.press({ key: 'cache' })
  expect(sent).toEqual(['Reply with only: ok'])
  expect(await ui.find({ type: 'Text', text: /extending/ })).toBeDefined()
  await ui.unmount()
})

test('no extend button while a reply runs', async ($, on) => {
  await resumed($, on, 7 * 60)
  const ui = await $.ui.mount(render('terminal', 140, true))
  expect(await ui.find({ key: 'cache' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^↻ 53m$/ })).toBeDefined()
  await ui.unmount()
})

test('no extend button on a cold cache, which shows its price', async ($, on) => {
  const sent: string[] = []
  await resumed($, on, 2 * 60 * 60, sent)
  const ui = await $.ui.mount(render('terminal'))
  expect(await ui.find({ type: 'Text', text: /◌ cold ~\$8\.00/ })).toBeDefined()
  await ui.press({ key: 'cache' })
  expect(sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: /next reply reads the whole chat again/ })).toBeDefined()
  await ui.unmount()
})

test('the reply size starts at M, a click moves it on, and a typed prompt carries it', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  engine(on)
  on('prompt.submit', (_: unknown, e: any) => {
    seen.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  expect(await ui.find({ type: 'Text', text: /^M$/ })).toBeDefined()
  await ui.press({ key: 'size' })
  expect(await ui.find({ type: 'Text', text: /^L$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Reply size L/ })).toBeDefined()
  await $.prompt.submit({ text: 'why?', origin: { kind: 'composer' } })
  await $.prompt.submit({ text: '/clear', origin: { kind: 'composer' } })
  expect(seen[0]?.at(-1)).toContain('Reply size L')
  expect(seen[1]).toBeUndefined()
  await ui.unmount()
})

test('the sun keeps the Mac awake with caffeinate, and says so', async ($, on) => {
  const spawned: string[][] = []
  engine(on)
  on('process.spawn', async function* (_: unknown, e: any) {
    spawned.push(e.argv)
    return { value: { code: 0, signal: null } }
  })
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  expect(await ui.find({ type: 'Text', text: /☼/ })).toBeDefined()
  await ui.press({ key: 'awake' })
  expect(spawned).toEqual([['/bin/sh', '-c', 'exec caffeinate -dis -w "$PPID"']])
  expect(await ui.find({ type: 'Text', text: /will not sleep|not keeping the Mac awake/ })).toBeDefined()
  await ui.unmount()
})

test('a click on the cost says what it counts, and a second click closes it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  await ui.press({ key: 'cost' })
  expect(await ui.find({ type: 'Text', text: /This session has spent \$0\.00/ })).toBeDefined()
  await ui.press({ key: 'cost' })
  expect(await ui.find({ type: 'Text', text: /This session has spent/ })).toBeUndefined()
  await ui.unmount()
})

test('a panel closes by itself, and one opened later is not closed early', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  await ui.press({ key: 'cost' })
  expect(await ui.find({ type: 'Text', text: /This session has spent/ })).toBeDefined()
  await clock!.advance(4000)
  await ui.press({ key: 'size' })
  await clock!.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Reply size/ })).toBeDefined()
  await clock!.advance(4000)
  expect(await ui.find({ type: 'Text', text: /Reply size/ })).toBeUndefined()
  await ui.unmount()
})

test('the context shows its tokens from load, and a click breaks them down', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  expect(await ui.find({ type: 'Text', text: /^ctx 23k$/ })).toBeDefined()
  await ui.press({ key: 'ctx' })
  expect(await ui.find({ type: 'Text', text: /23k of 200k tokens used \(12%\)\.\nSystem tools 14k/ })).toBeDefined()
  await ui.press({ key: 'ctx' })
  expect(await ui.find({ type: 'Text', text: /tokens used/ })).toBeUndefined()
  await ui.unmount()
})
