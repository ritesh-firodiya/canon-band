import { expect, mock, test } from 'claude-code/testing'

import { breakdownLine, cacheView, canExtend, coldLabel, contextView, extendLabel, infoLine, isNarrow, isTyped, nextMode, nextSize, recommendationOf, replyRule, tokens, windowViews } from './facts'
import { commandRisk, readRisk } from './guard'
import { priceOf } from './prices'

const OPUS = 'claude-opus-5-5'
const render = (surface: 'terminal' | 'desktop', columns = 140, isWorking = false) =>
  ({ plugin: 'canon-band', component: 'AbovePrompt', surface, props: { hasSurvey: false, isWorking, maxRows: 12, bodyColumns: columns, scroll: { offset: 0, bodyRows: 12 }, view: {} } }) as const

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
  expect(breakdownLine(ROWS).split('\n')).toEqual([
    '  System tools          14k',
    '  Messages               6k',
    '  System prompt        3.1k',
    '  Free space           144k',
    '  Autocompact buffer    33k',
  ])
})

test('reply size goes S, M, L and round, and each size tells the model what to write in plain words', () => {
  expect([nextSize('S'), nextSize('M'), nextSize('L')]).toEqual(['M', 'L', 'S'])
  expect(replyRule('S', 'manual')).toContain('one to three short lines, no headings or tables, in plain words')
  expect(replyRule('L', 'manual')).toContain('trade-offs')
  expect(replyRule('S', 'manual')).not.toContain('Recommend:')
  expect(replyRule('S', 'assisted')).toContain('"Recommend: <what you would do')
  expect([nextMode('assisted'), nextMode('manual')]).toEqual(['manual', 'assisted'])
})

test('only what the person types carries the rule: not slash commands, SDK runs, schedules or other agents', () => {
  expect(isTyped('why?', 'composer')).toBe(true)
  expect(isTyped('why?', 'bridge')).toBe(true)
  expect(isTyped('/clear', 'composer')).toBe(false)
  expect(isTyped('  ', 'composer')).toBe(false)
  for (const origin of ['sdk', 'plugin', 'scheduled-trigger', 'peer', 'coordinator', 'unclassified']) expect(isTyped('why?', origin)).toBe(false)
})

test('the last Recommend: line is the pick, markdown and all', () => {
  expect(recommendationOf('Two ways.\n\nRecommend: rename the repo to canon-band')).toBe('rename the repo to canon-band')
  expect(recommendationOf('**Recommend:** keep it\nRecommend: `drop it`')).toBe('drop it')
  expect(recommendationOf('Done. Tests pass.')).toBeNull()
  expect(recommendationOf('Recommend:')).toBeNull()
})

test('critical commands need the person, everyday ones do not', () => {
  const critical = ['rm -rf dist', 'rm -r old', 'cd x && git push origin main', 'git push --force', 'git reset --hard HEAD~1', 'git clean -fd', 'git branch -D old', 'psql -c "DROP TABLE users"', 'pnpm prisma migrate reset', 'vercel --prod', 'firebase deploy', 'eas submit -p ios', 'npm publish', 'npm deprecate x "gone"', 'gh release create v1', 'gh repo delete me/x', 'gh repo edit --visibility public', 'stripe charges create --live', 'cat .env', 'cat apps/web/.env.local', 'cp key.p8 /tmp', 'ls ~/git/local/secrets']
  const everyday = ['git status', 'git log -3', 'rm file.txt', 'git pull', 'pnpm test', 'cat .env.example', 'grep -r environment src', 'git commit -m "push the band below" -- README.md', 'npm view x version']
  for (const c of critical) expect([c, commandRisk(c)]).toEqual([c, expect.any(String)])
  for (const c of everyday) expect([c, commandRisk(c)]).toEqual([c, null])
  expect(readRisk('/w/shop/.env')).toBe('reading a secret')
  expect(readRisk('/w/shop/.env.example')).toBeNull()
  expect(readRisk('/Users/me/git/local/secrets/x/key')).toBe('reading a secret')
  expect(readRisk('/w/shop/src/env.ts')).toBeNull()
})

test('a narrow terminal uses two rows', () => {
  expect(isNarrow(80)).toBe(true)
  expect(isNarrow(120)).toBe(false)
})

test('a click on a short item says what it means in one line', () => {
  const base = { isAwake: false, mode: 'assisted' as const, size: 'M' as const, sessionUsd: 1.2, windows: windowViews([{ kind: 'seven_day', percentUsed: 91, resetsAt: '2026-11-05T09:00:00Z' }], Date.parse('2026-11-02T00:00:00Z')), context: contextView({ tokens: 80_000, window: 200_000, percent: 40 }), breakdown: null, cache: null }
  expect(infoLine('awake', base)).toContain('not keeping the Mac awake')
  expect(infoLine('awake', { ...base, isAwake: true })).toContain('will not sleep')
  expect(infoLine('size', base)).toContain('short bullet list')
  expect(infoLine('cost', base)).toBe('This session has spent $1.20.')
  expect(infoLine('7D', base)).toBe('7D: 91% of your weekly limit is used. It resets in 3d 9h.')
  expect(infoLine('5H', base)).toBe('5H: no reading yet.')
  expect(infoLine('ctx', base)).toBe('ctx: 80k of 200k tokens used (40%).')
  expect(infoLine('ctx', { ...base, breakdown: ROWS })).toContain('\n  System tools          14k\n  Messages               6k')
  expect(infoLine('mode', base)).toContain('Assisted')

})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on ${surface}, the band draws the sun, the cost, the mode, the reply size and the context`, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/w/shop', surface, isInteractive: true })
    const ui = await $.ui.mount(render(surface))
    expect(await ui.find({ type: 'Text', text: /☼/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^assisted$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^S$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$0\.00$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ctx 23k$/ })).toBeDefined()
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

test('the reply size starts at S, a click moves it on, and only a typed prompt carries it', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  engine(on)
  on('prompt.submit', (_: unknown, e: any) => {
    seen.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  expect(await ui.find({ type: 'Text', text: /^S$/ })).toBeDefined()
  await ui.press({ key: 'size' })
  expect(await ui.find({ type: 'Text', text: /^M$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Reply size M/ })).toBeDefined()
  await $.prompt.submit({ text: 'why?', origin: { kind: 'composer' } })
  await $.prompt.submit({ text: '/clear', origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'run the turn', origin: { kind: 'sdk' } })
  expect(seen[0]?.at(-1)).toContain('Reply size M')
  expect(seen[0]?.at(-1)).toContain('Recommend:')
  expect(seen[1]).toBeUndefined()
  expect(seen[2]).toBeUndefined()
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

test('a click on ctx breaks the tokens down, and a second click closes it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  await ui.press({ key: 'ctx' })
  expect(await ui.find({ type: 'Text', text: /^ctx: 23k of 200k tokens used \(12%\)\.\n  System tools +14k\n  Messages +6k/ })).toBeDefined()
  await ui.press({ key: 'ctx' })
  expect(await ui.find({ type: 'Text', text: /tokens used/ })).toBeUndefined()
  await ui.unmount()
})

test('a click on the cost says what it counts', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  await ui.press({ key: 'cost' })
  expect(await ui.find({ type: 'Text', text: /This session has spent \$0\.00/ })).toBeDefined()
  await ui.unmount()
})

test('a panel closes by itself, and one opened later is not closed early', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(render('terminal'))
  await ui.press({ key: 'mode' })
  expect(await ui.find({ type: 'Text', text: /Manual: no recommendation button/ })).toBeDefined()
  await clock!.advance(4000)
  await ui.press({ key: 'size' })
  await clock!.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Reply size/ })).toBeDefined()
  await clock!.advance(4000)
  expect(await ui.find({ type: 'Text', text: /Reply size/ })).toBeUndefined()
  await ui.unmount()
})

test('a critical command waits for Allow once, then runs once', async ($, on) => {
  const sent: string[] = []
  const ran: string[] = []
  engine(on)
  on('prompt.submit', (_: unknown, e: any) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('tool.call', (_: unknown, e: any) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  const push = { tool: 'Bash', command: 'git push origin main' } as any
  expect(await $.tool.call(push)).toMatchObject({ deny: expect.stringContaining('a push') })
  const ui = await $.ui.mount(render('terminal'))
  expect(await ui.find({ type: 'Text', text: /Claude wants to run a push: git push origin main/ })).toBeDefined()
  await ui.press({ key: 'allow' })
  expect(sent).toEqual(['Allowed once: run `git push origin main` again.'])
  expect(await ui.find({ type: 'Text', text: /Claude wants to run/ })).toBeUndefined()
  await $.tool.call(push)
  expect(await $.tool.call(push)).toMatchObject({ deny: expect.any(String) })
  expect(await $.tool.call({ tool: 'Bash', command: 'git status' } as any)).not.toHaveProperty('deny')
  expect(ran).toEqual(['git push origin main', 'git status'])
  await ui.unmount()
})

test('a headless run is not guarded by the band', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: false })
  expect(await $.tool.call({ tool: 'Bash', command: 'git push' } as any)).not.toHaveProperty('deny')
})

test('in assisted mode, a recommendation gets a Go with it button', async ($, on) => {
  const sent: string[] = []
  engine(on)
  on('prompt.submit', (_: unknown, e: any) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  await $.session.start({ cwd: '/w/shop', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'Two ways.\nRecommend: rename the repo to canon-band', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  const ui = await $.ui.mount(render('terminal'))
  expect(await ui.find({ type: 'Text', text: /Claude recommends: rename the repo to canon-band/ })).toBeDefined()
  await ui.press({ key: 'go' })
  expect(sent).toEqual(['Go with your recommendation: rename the repo to canon-band'])
  expect(await ui.find({ type: 'Text', text: /Claude recommends/ })).toBeUndefined()
  await ui.unmount()
})
