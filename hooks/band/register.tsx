import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import { addSpend, cacheView, canExtend, coldLabel, contextView, extendLabel, FAMILIES, familyOf, infoLine, isEffort, isNarrow, isTyped, money, monthOf, monthTotal, monthView, nextEffort, nextMode, nextSize, recommendationOf, replyRule, switchLabel, switchUsd, windowViews } from './facts'
import { commandRisk, readRisk } from './guard'
import type { Blocked, CacheFacts, ContextFacts, ContextRow, Effort, Family, Info, Level, Mode, MonthSpend, ReplySize, UsageWindow } from './types'

// The band above the prompt: the awake toggle, cost, mode and reply size on the left, usage, context and cache on the right.
// What needs the person (a blocked command, a recommendation) gets its own row above it.
// Cache and usage logic follow ribbon (MIT, robonuggets/ribbon).

const TICK_MS = 30_000
const EXTEND_MESSAGE = 'Reply with only: ok'

const AMBER = '#f0b429'
const RED = '#ff7b72'
const GREEN = '#56d364'

const LEVEL_COLOR: Record<Level, string> = { ok: GREEN, warn: AMBER, bad: RED }

const windows = atom({ plugin: 'canon-band', key: 'windows' } as const, [] as UsageWindow[])
const cache = atom({ plugin: 'canon-band', key: 'cache' } as const, null as CacheFacts | null)
const taskUsd = atom({ plugin: 'canon-band', key: 'taskUsd' } as const, 0)
const panel = atom({ plugin: 'canon-band', key: 'panel' } as const, null as Info | null)
const isExtending = atom({ plugin: 'canon-band', key: 'isExtending' } as const, false)
const context = atom({ plugin: 'canon-band', key: 'context' } as const, null as ContextFacts | null)
const breakdown = atom({ plugin: 'canon-band', key: 'breakdown' } as const, null as ContextRow[] | null)
const isAwake = atom({ plugin: 'canon-band', key: 'isAwake' } as const, false)
const replySize = atom({ plugin: 'canon-band', key: 'replySize' } as const, 'S' as ReplySize)
const mode = atom({ plugin: 'canon-band', key: 'mode' } as const, 'assisted' as Mode)
const recommendation = atom({ plugin: 'canon-band', key: 'recommendation' } as const, null as string | null)
const blocked = atom({ plugin: 'canon-band', key: 'blocked' } as const, null as Blocked | null)
// The effort the person picked on the band, and the one the engine last sent; null until there is one.
const effort = atom({ plugin: 'canon-band', key: 'effort' } as const, null as Effort | null)
const seenEffort = atom({ plugin: 'canon-band', key: 'seenEffort' } as const, null as Effort | null)
const monthUsd = atom({ plugin: 'canon-band', key: 'monthUsd' } as const, 0)
const isPicking = atom({ plugin: 'canon-band', key: 'isPicking' } as const, false)

// This Mac's spend by month, across sessions.
const MONTH_KEY = 'month'

/** Adds this session's spend to the month's, and shows the month's total. */
async function recordSpend($: EngineInterface, usd: number | null): Promise<void> {
  const month = monthOf(await $.clock.now())
  const stored = ((await $.store.get(MONTH_KEY)) ?? null) as MonthSpend | null
  // shortcut: a session that runs across a month's end counts all of it in the new month; split it if anyone needs exact months.
  const next = usd === null ? stored : addSpend(stored, month, await $.session.id(), usd)
  if (next !== stored) await $.store.set(MONTH_KEY, next)
  await update($, monthUsd, () => monthTotal(next, month))
}

// Headless runs (Archon, Babul, `claude -p`) have no one to click Allow once; Babul's own hook guards those.
let isInteractive = false
// Commands the person allowed, each for one run. Module state, so a reload asks again.
const allowedOnce = new Set<string>()

/** Refuses a critical operation until the person allows it once on the band. */
async function guard($: EngineInterface, command: string, what: string | null): Promise<{ deny: string } | null> {
  if (!what || !isInteractive) return null
  if (allowedOnce.delete(command)) return null
  await update($, blocked, () => ({ command, what }))
  return { deny: `canon-band: this is ${what}, which needs the person's yes. Stop and wait: they can click Allow once above the prompt, and then you run the exact same command again.` }
}

// The caffeinate child behind ☀; ☼ when there is none. Module state, so a reload, which kills it, starts asleep again.
// -w ties caffeinate to the process that started it, so a crash or kill -9 of Claude Code cannot leave the Mac awake.
// -d keeps the display on, so the screen never locks; -i and -s keep the system up, on battery and on power.
const CAFFEINATE = 'exec caffeinate -dis -w "$PPID"'

let awakeChild: ReturnType<EngineInterface['process']['spawn']> | null = null

// shortcut: caffeinate is macOS only, so elsewhere a click says it could not start; hide the sun off macOS if anyone uses it there.
async function setAwake($: EngineInterface, isOn: boolean): Promise<void> {
  const before = awakeChild
  awakeChild = null
  // Ending the loop ends the child; not awaited, since the loop sits on a read that only the child's end settles.
  void before?.return(undefined as never)
  await update($, isAwake, () => isOn)
  if (!isOn) return
  const child = $.process.spawn({ argv: ['/bin/sh', '-c', CAFFEINATE] })
  awakeChild = child
  void (async () => {
    try {
      for await (const _ of child) {
        // caffeinate prints nothing; the loop only marks its life.
      }
    } catch {
      await $.ui.toast('Could not keep this Mac awake: caffeinate did not start.')
    }
    if (awakeChild !== child) return
    awakeChild = null
    await update($, isAwake, () => false)
  })()
}

async function refreshUsage($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> {
  const usage = await $.session.usage()
  await update($, windows, () => usage.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt })))
  await update($, taskUsd, value => usage.cost?.usd ?? value)
  const { tokens: used, percent, window } = usage.context
  if (used !== undefined && percent !== undefined) await update($, context, () => ({ tokens: used, window, percent }))
  const known = model ?? (await $.session.model())
  await update($, cache, c => ({
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: usage.context.tokens && usage.context.tokens > 0 ? usage.context.tokens : (c?.tokens ?? 0),
    model: known || c?.model || null,
  }))
}

/** The window and what fills it. Before the first reply the engine has no reading, so its local estimate stands in; it sends nothing. */
async function refreshContext($: EngineInterface): Promise<void> {
  const { context: live } = await $.session.usage({ breakdown: 'summary' })
  const b = live.breakdown
  if (b) await update($, breakdown, () => b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })))
  if (live.tokens !== undefined && live.percent !== undefined) await update($, context, () => ({ tokens: live.tokens as number, window: live.window, percent: live.percent as number }))
  else if (b) await update($, context, () => ({ tokens: b.totalTokens, window: b.rawMaxTokens, percent: b.percentage }))
}

const READ_MS = 5000
// The breakdown is a longer line, so it stays up longer.
const READ_LONG_MS = 12_000
let shown = 0

/** Opens a panel, or closes it with null. It closes after time to read it, unless another opened since. */
async function showPanel($: EngineInterface, name: Info | null): Promise<void> {
  const mine = ++shown
  await update($, panel, () => name)
  if (!name) return
  $.clock.after(name === 'ctx' ? READ_LONG_MS : READ_MS, async () => {
    if (shown === mine) await update($, panel, () => null)
  })
}

export const register: Register = (on, options) => {
  const budget = Number(options.monthlyBudgetUsd) > 0 ? Number(options.monthlyBudgetUsd) : null

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await setAwake($, false)
    $.clock.every(TICK_MS, async () => $.ui.invalidate('ui.render'))
    const result = await next(e)
    if (isInteractive) await refreshContext($).catch(() => undefined)
    await recordSpend($, null).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  // A resumed session knows how long it was away; a cleared one starts over.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, context, () => null)
      await update($, breakdown, () => null)
      await update($, recommendation, () => null)
      if (e.source === 'clear') await update($, panel, () => null)
      await refreshContext($).catch(() => undefined)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const seconds = e.seconds_since_last_response
      await update($, cache, () => ({
        lastAt: now - seconds * 1000,
        tokens: typeof e.context_tokens === 'number' ? e.context_tokens : 0,
        model: typeof e.model === 'string' ? e.model : null,
      }))
    }
    return result
  }).catch(($, e, next) => next(e))

  // Beside the prompt, not in the system prompt, so a new size or mode keeps the cache.
  on('prompt.submit', async ($, e, next) => {
    await update($, recommendation, () => null)
    if (!isTyped(e.text, e.origin.kind)) return next(e)
    return next({ ...e, context: [...(e.context ?? []), replyRule(await read($, replySize), await read($, mode))] })
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => (await guard($, e.command, commandRisk(e.command))) ?? next(e))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'canon-band: its guard failed, so the command did not run.' }))
  on('tool.call', { tool: 'Read' }, async ($, e, next) => (await guard($, e.file_path, readRisk(e.file_path))) ?? next(e))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'canon-band: its guard failed, so the file was not read.' }))

  on('turn.step', async function* ($, e, next) {
    // Each main request reads or writes the cache, so its start restarts the hour.
    if (e.agentId) return yield* next(e)
    const now = await $.clock.now()
    await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, model: e.model }))
    // An effort picked on the band goes with each main request; changing it keeps the cache.
    const picked = await read($, effort)
    const sent = picked ?? e.effort
    if (isEffort(sent)) await update($, seenEffort, () => sent)
    yield* next(picked ? { ...e, effort: picked } : e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    await update($, isExtending, () => false)
    if ((await read($, mode)) === 'assisted' && e.reason === 'answer') await update($, recommendation, () => recommendationOf(e.answer))
    await refreshUsage($, await $.clock.now(), e.usage?.model ?? null)
    await recordSpend($, (await $.session.usage()).cost?.usd ?? null).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Other mods share this slot: theirs draw below.
    const below = await next(e).catch(() => undefined)
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const open = await read($, panel)
    const extending = await read($, isExtending)
    const view = cacheView(await read($, cache), now)
    const usage = windowViews(await read($, windows), now)
    const sessionUsd = await read($, taskUsd)
    const ctx = contextView(await read($, context))
    const awake = await read($, isAwake)
    const size = await read($, replySize)
    const current = await read($, mode)
    const pick = await read($, recommendation)
    const stopped = await read($, blocked)
    const family = familyOf(await $.session.model())
    const shownEffort = (await read($, effort)) ?? (await read($, seenEffort))
    const picking = await read($, isPicking)
    const tokensNow = (await read($, cache))?.tokens ?? (await read($, context))?.tokens ?? 0
    const spentThisMonth = await read($, monthUsd)

    const toggle = (name: Info) => async () => showPanel($, (await read($, panel)) === name ? null : name)
    // An action says what it did, so a second click acts again instead of closing.
    const say = (name: Info) => showPanel($, name)
    const showContext = async () => {
      if ((await read($, panel)) === 'ctx') return showPanel($, null)
      await refreshContext($).catch(() => undefined)
      await say('ctx')
    }
    const extend = async () => {
      await update($, isExtending, () => true)
      await say('cache')
      void $.prompt.submit({ text: EXTEND_MESSAGE })
    }
    const answer = async (text: string) => {
      await update($, recommendation, () => null)
      void $.prompt.submit({ text })
    }
    const allow = async (b: Blocked, isAllowed: boolean) => {
      await update($, blocked, () => null)
      if (isAllowed) allowedOnce.add(b.command)
      void $.prompt.submit({ text: isAllowed ? `Allowed once: run \`${b.command}\` again.` : `Not allowed: do not run \`${b.command}\`. Find another way, or stop and say why.` })
    }
    const button = (key: string, label: string, color: string | undefined, onPress: () => unknown) => (
      <Button key={key} plain onPress={onPress}><Text color={color} dimColor={!color}>{label}</Text></Button>
    )

    const switchTo = async (to: Family | null) => {
      await update($, isPicking, () => false)
      if (to) void $.command.run({ command: 'model', args: to })
    }
    const pickModel = [
      <Text key="switch">Switch model: the next message reloads the whole chat.</Text>,
      ...FAMILIES.filter(f => f !== family).map(f => button(`to-${f}`, `[${switchLabel(f, switchUsd(tokensNow, f))}]`, AMBER, () => switchTo(f))),
      button('cancel', '[Cancel]', undefined, () => switchTo(null)),
    ]

    // What needs the person, on its own row above the band: a blocked command first, then a recommendation.
    const needs = stopped
      ? [<Text key="ask" color={RED}>{`Claude wants to run ${stopped.what}: ${stopped.command.slice(0, 60)}`}</Text>, button('allow', '[Allow once]', GREEN, () => allow(stopped, true)), button('block', '[Block]', RED, () => allow(stopped, false))]
      : pick && current === 'assisted' && !e.props.isWorking
        ? [<Text key="pick">{`Claude recommends: ${pick.slice(0, 70)}`}</Text>, button('go', '[Go with it]', GREEN, () => answer(`Go with your recommendation: ${pick}`)), button('skip', '[Not now]', undefined, async () => update($, recommendation, () => null))]
        : picking
          ? pickModel
          : []

    const left = [
      <Button key="awake" plain onPress={async () => { await setAwake($, !awake); await say('awake') }}>
        <Text color={awake ? GREEN : undefined} bold={awake}>{awake ? '☀︎' : '☼'}</Text>
      </Button>,
      button('cost', money(sessionUsd), undefined, toggle('cost')),
      button('mode', current, current === 'assisted' ? GREEN : undefined, async () => { await update($, mode, nextMode); await say('mode') }),
      button('size', size, AMBER, async () => { await update($, replySize, nextSize); await say('size') }),
      button('model', family ?? 'model', undefined, async () => update($, isPicking, p => !p)),
      button('effort', shownEffort ?? 'effort', undefined, async () => { await update($, effort, () => nextEffort(shownEffort ?? 'medium')); await say('effort') }),
    ]

    const warm = view?.mode === 'warm' ? view : null
    const right = [
      ...usage.map(w => button(w.name, w.label, LEVEL_COLOR[w.level], toggle(w.name as Info))),
      // Off a Claude plan (Bedrock, Vertex, an API key) there are no 7D or 5H windows, so this Mac's month stands in.
      !usage.some(w => w.name !== 'Spend') || budget ? (() => {
        const m = monthView(monthOf(now), spentThisMonth, budget)
        return button('month', m.label, LEVEL_COLOR[m.level], toggle('month'))
      })() : null,
      ctx ? button('ctx', ctx.label, LEVEL_COLOR[ctx.level], showContext) : null,
      view?.mode === 'cold' ? button('cache', coldLabel(view.nextUsd), AMBER, toggle('cache')) : null,
      extending ? <Text key="extending" dimColor>extending...</Text> : null,
      !extending && warm && canExtend(warm, e.props.isWorking) ? button('cache', extendLabel(warm.minutesLeft, warm.extendUsd), GREEN, extend) : null,
      !extending && warm && !canExtend(warm, e.props.isWorking) ? <Text key="cache-time" color={GREEN}>{extendLabel(warm.minutesLeft, null)}</Text> : null,
    ]

    const row = (key: string, start: RenderChildren[], end: RenderChildren[]) => (
      <Box key={key} flexDirection="row" gap={2} width={e.props.bodyColumns}>
        {start}
        <Box key="grow" flexGrow={1} />
        {end}
      </Box>
    )
    const rows = isNarrow(e.props.bodyColumns) ? [row('controls', left, []), row('limits', [], right)] : [row('band', left, right)]
    const line = open ? infoLine(open, { isAwake: awake, mode: current, size, sessionUsd, windows: usage, context: ctx, breakdown: await read($, breakdown), cache: view, effort: shownEffort, monthUsd: spentThisMonth, budget }) : ''
    const mine = (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {needs.length ? row('needs', needs, []) : null}
        {rows}
        {line ? <Text key="info-line">{line}</Text> : null}
      </Box>
    )
    return below ? <Box flexDirection="column">{mine}{below}</Box> : mine
  }).catch(($, e, next) => next(e))
}
