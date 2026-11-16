import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import { cacheView, canExtend, coldLabel, contextView, extendLabel, infoLine, isNarrow, isTyped, money, nextSize, replyRule, windowViews } from './facts'
import type { CacheFacts, Info, Level, ReplySize, UsageWindow } from './types'

// The band above the prompt: the session's cost and awake toggle on the left, reply size and what is left on the right.
// Cache and usage logic follow ribbon (MIT, robonuggets/ribbon).

const TICK_MS = 30_000
const EXTEND_MESSAGE = 'Reply with only: ok'

const AMBER = '#f0b429'
const RED = '#ff7b72'
const GREEN = '#56d364'

const windows = atom({ plugin: 'canon', key: 'windows' } as const, [] as UsageWindow[])
const cache = atom({ plugin: 'canon', key: 'cache' } as const, null as CacheFacts | null)
const taskUsd = atom({ plugin: 'canon', key: 'taskUsd' } as const, 0)
const panel = atom({ plugin: 'canon', key: 'panel' } as const, null as Info | null)
const isExtending = atom({ plugin: 'canon', key: 'isExtending' } as const, false)
const contextUsed = atom({ plugin: 'canon', key: 'contextUsed' } as const, null as number | null)
const isAwake = atom({ plugin: 'canon', key: 'isAwake' } as const, false)
const replySize = atom({ plugin: 'canon', key: 'replySize' } as const, 'M' as ReplySize)

const LEVEL_COLOR: Record<Level, string> = { ok: GREEN, warn: AMBER, bad: RED }

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
  await update($, contextUsed, value => usage.context.percent ?? value)
  const known = model ?? (await $.session.model())
  await update($, cache, c => ({
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: usage.context.tokens && usage.context.tokens > 0 ? usage.context.tokens : (c?.tokens ?? 0),
    model: known || c?.model || null,
  }))
}

const READ_MS = 5000
let shown = 0

/** Opens a panel, or closes it with null. It closes after time to read it, unless another opened since. */
async function showPanel($: EngineInterface, name: Info | null): Promise<void> {
  const mine = ++shown
  await update($, panel, () => name)
  if (!name) return
  $.clock.after(READ_MS, async () => {
    if (shown === mine) await update($, panel, () => null)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setAwake($, false)
    $.clock.every(TICK_MS, async () => $.ui.invalidate('ui.render'))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A resumed session knows how long it was away; a cleared one starts over.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, contextUsed, () => null)
      if (e.source === 'clear') await update($, panel, () => null)
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

  // Beside the prompt, not in the system prompt, so a new size keeps the cache.
  on('prompt.submit', async ($, e, next) => {
    if (!isTyped(e.text, e.origin.kind === 'plugin')) return next(e)
    return next({ ...e, context: [...(e.context ?? []), replyRule(await read($, replySize))] })
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    // Each main request reads or writes the cache, so its start restarts the hour.
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, model: e.model }))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    await update($, isExtending, () => false)
    await refreshUsage($, await $.clock.now(), e.usage?.model ?? null)
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
    const context = contextView(await read($, contextUsed))
    const awake = await read($, isAwake)
    const size = await read($, replySize)

    const toggle = (name: Info) => async () => showPanel($, (await read($, panel)) === name ? null : name)
    // An action says what it did, so a second click acts again instead of closing.
    const say = (name: Info) => showPanel($, name)
    const extend = async () => {
      await update($, isExtending, () => true)
      await say('cache')
      void $.prompt.submit({ text: EXTEND_MESSAGE })
    }
    const item = (key: Info, label: string, color?: string, onPress: () => unknown = toggle(key)) => (
      <Button key={key} plain onPress={onPress}><Text color={color} dimColor={!color}>{label}</Text></Button>
    )

    const left = [
      <Button key="awake" plain onPress={async () => { await setAwake($, !awake); await say('awake') }}>
        <Text color={awake ? GREEN : undefined} bold={awake}>{awake ? '☀︎' : '☼'}</Text>
      </Button>,
      item('cost', money(sessionUsd)),
    ]

    const warm = view?.mode === 'warm' ? view : null
    const right = [
      <Button key="size" plain onPress={async () => { await update($, replySize, nextSize); await say('size') }}><Text color={AMBER} bold>{size}</Text></Button>,
      ...usage.map(w => item(w.name as Info, w.label, LEVEL_COLOR[w.level])),
      context ? item('ctx', context.label, LEVEL_COLOR[context.level]) : null,
      view?.mode === 'cold' ? item('cache', coldLabel(view.nextUsd), AMBER) : null,
      extending ? <Text key="extending" dimColor>extending...</Text> : null,
      !extending && warm && canExtend(warm, e.props.isWorking) ? item('cache', extendLabel(warm.minutesLeft, warm.extendUsd), GREEN, extend) : null,
      !extending && warm && !canExtend(warm, e.props.isWorking) ? <Text key="cache-time" color={GREEN}>{extendLabel(warm.minutesLeft, null)}</Text> : null,
    ]

    const row = (key: string, start: RenderChildren[], end: RenderChildren[]) => (
      <Box key={key} flexDirection="row" gap={2} width={e.props.bodyColumns}>
        {start}
        <Box key="grow" flexGrow={1} />
        {end}
      </Box>
    )
    const rows = isNarrow(e.props.bodyColumns) ? [row('session', left, []), row('limits', [], right)] : [row('session', left, right)]
    const line = open ? infoLine(open, { isAwake: awake, size, sessionUsd, windows: usage, context, cache: view }) : ''

    const mine = (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {rows}
        {line ? <Text key="info">{line}</Text> : null}
      </Box>
    )
    return below ? <Box flexDirection="column">{mine}{below}</Box> : mine
  }).catch(($, e, next) => next(e))
}
