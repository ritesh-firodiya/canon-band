// Pure helpers for the band: no `$`, so the tests call them directly.

import { priceOf } from './prices'
import type { CacheFacts, ContextFacts, ContextRow, Info, Level, Mode, ReplySize, UsageWindow } from './types'

export const TTL_MS = 60 * 60 * 1000
const HIGH_AT = 80
const WARN_AT = 60
const PER_MILLION = 1_000_000
const NARROW_BELOW = 110

export const money = (usd: number): string => `$${usd.toFixed(2)}`

export const isNarrow = (columns: number): boolean => columns < NARROW_BELOW
const CENT = 0.01
const round = (usd: number): string => (usd < CENT ? '<$0.01' : `$${usd.toFixed(2)}`)

export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export interface WindowView {
  name: string
  used: number
  /** Only when it is high, since that is when it matters. */
  reset: string | null
  label: string
  level: Level
}

/** How much is used decides the colour: red when it is about to run out. */
export const levelOf = (used: number): Level => (used >= HIGH_AT ? 'bad' : used >= WARN_AT ? 'warn' : 'ok')

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }

/** Usage so far, rising from 0: the reset time only when it is high, since that is when it matters. */
export function windowViews(windows: readonly UsageWindow[], now: number): WindowView[] {
  return [...windows]
    .filter(w => NAMES[w.kind])
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))
    .map(w => {
      const used = Math.min(100, Math.max(0, Math.round(w.percentUsed)))
      const level = levelOf(used)
      const name = NAMES[w.kind] as string
      const reset = level === 'bad' && w.resetsAt ? duration(Date.parse(w.resetsAt) - now) : null
      return { name, used, reset, label: `${name} ${used}%${reset ? ` ${reset}` : ''}`, level }
    })
}

/** 850, 8.4k, 23k, 1.2M: short enough for the band. */
export function tokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export interface ContextView {
  tokens: number
  window: number
  percent: number
  label: string
  level: Level
}

/** Tokens in the context window, from the session's load on; null before any reading. */
export function contextView(facts: ContextFacts | null): ContextView | null {
  if (!facts) return null
  return { ...facts, label: `ctx ${tokens(facts.tokens)}`, level: levelOf(facts.percent) }
}

/** What fills the window, largest first, then what is free: the line a click on ctx shows. */
export function breakdownLine(rows: readonly ContextRow[]): string {
  const used = rows.filter(r => r.kind === 'used' && r.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const free = rows.filter(r => r.kind === 'free' || r.kind === 'buffer')
  return [...used, ...free].map(r => `${r.name} ${tokens(r.tokens)}`).join(' · ')
}

export type CacheView =
  | { mode: 'warm'; minutesLeft: number; extendUsd: number | null }
  | { mode: 'cold'; nextUsd: number | null }

/** Warm for an hour after the last request. Null before there is anything cached. */
export function cacheView(cache: CacheFacts | null, now: number): CacheView | null {
  if (!cache || cache.lastAt <= 0 || cache.tokens <= 0) return null
  const idle = Math.max(0, now - cache.lastAt)
  const price = cache.model ? priceOf(cache.model, cache.tokens) : null
  if (idle >= TTL_MS) return { mode: 'cold', nextUsd: price ? (cache.tokens * price.write1h) / PER_MILLION : null }
  return { mode: 'warm', minutesLeft: Math.ceil((TTL_MS - idle) / 60000), extendUsd: price ? (cache.tokens * price.cacheRead) / PER_MILLION : null }
}

const about = (usd: number): string => `${usd < CENT ? '' : '~'}${round(usd)}`
export const extendLabel = (minutes: number, usd: number | null): string => `↻ ${minutes}m${usd === null ? '' : ` +${round(usd)}`}`
export const coldLabel = (usd: number | null): string => (usd === null ? '◌ cold' : `◌ cold ${about(usd)}`)

/** Extend shows only when it can do something: the cache is warm and no reply is running. */
export const canExtend = (view: CacheView | null, isBusy: boolean): boolean => view?.mode === 'warm' && !isBusy

export const SIZES: readonly ReplySize[] = ['S', 'M', 'L']
export const nextSize = (size: ReplySize): ReplySize => SIZES[(SIZES.indexOf(size) + 1) % SIZES.length] as ReplySize

const SIZE_WORDS: Record<ReplySize, string> = {
  S: 'one to three short lines, no headings or tables',
  M: 'the answer first, then a short bullet list',
  L: 'the answer first, then steps, reasons and trade-offs',
}

export const MODES: readonly Mode[] = ['assisted', 'manual']
export const nextMode = (mode: Mode): Mode => (mode === 'assisted' ? 'manual' : 'assisted')

const RECOMMEND = 'Recommend:'
const ASSISTED_RULE = `When you end with a choice the person can accept, add one last line: "${RECOMMEND} <what you would do, in a few plain words>".`

/** What the model reads beside each prompt, so the size and mode hold without touching the cached system prompt. */
export function replyRule(size: ReplySize, mode: Mode): string {
  const rule = `Reply size ${size}: write ${SIZE_WORDS[size]}, in plain words, the way a person talks. The person set this on the band; it overrides other length guidance.`
  return mode === 'assisted' ? `${rule} ${ASSISTED_RULE}` : rule
}

// The person's own message: Enter at the prompt, or the phone through Remote Control. Never an SDK run, a schedule or another agent.
const PERSON = new Set(['composer', 'bridge'])

/** A prompt the person typed, not a slash command. Only these carry the reply rule. */
export const isTyped = (text: string, origin: string): boolean => PERSON.has(origin) && text.trim() !== '' && !text.trimStart().startsWith('/')

/** The last "Recommend:" line of an answer, or null when it has none. */
export function recommendationOf(answer: string): string | null {
  const lines = answer.split('\n').map(l => l.replace(/[*_`]/g, '').trim())
  const last = lines.filter(l => l.startsWith(RECOMMEND)).at(-1)
  const text = last?.slice(RECOMMEND.length).trim()
  return text ? text : null
}

export interface InfoFacts {
  isAwake: boolean
  mode: Mode
  size: ReplySize
  sessionUsd: number
  windows: readonly WindowView[]
  context: ContextView | null
  breakdown: readonly ContextRow[] | null
  cache: CacheView | null
}

/** The one line a click on a short item shows, so a glyph never has to be guessed. */
export function infoLine(info: Info, f: InfoFacts): string {
  const limit = (name: string, what: string) => {
    const w = f.windows.find(entry => entry.name === name)
    return w ? `${name}: ${w.used}% of your ${what} limit is used.${w.reset ? ` It resets in ${w.reset}.` : ''}` : `${name}: no reading yet.`
  }
  if (info === 'awake') return f.isAwake ? '☀ Awake: this Mac will not sleep while this session is open. Click again to let it sleep.' : '☼ This session is not keeping the Mac awake. Click to keep it awake while this session is open.'
  if (info === 'size') return `Reply size ${f.size}: ${SIZE_WORDS[f.size]}. Click again for the next size.`
  if (info === 'mode') return f.mode === 'assisted' ? 'Assisted: when Claude recommends something, a Go with it button sends it on. Click for manual.' : 'Manual: no recommendation button. Click for assisted.'
  if (info === 'cost') return `This session has spent ${money(f.sessionUsd)}.`
  if (info === '7D') return limit('7D', 'weekly')
  if (info === '5H') return limit('5H', 'five-hour')
  if (info === 'ctx') {
    if (!f.context) return 'ctx: no reading yet.'
    const head = `ctx: ${tokens(f.context.tokens)} of ${tokens(f.context.window)} tokens used (${f.context.percent}%).${f.context.percent >= HIGH_AT ? ' Compact or start a new session.' : ''}`
    return f.breakdown?.length ? `${head}\n${breakdownLine(f.breakdown)}` : head
  }
  if (f.cache?.mode === 'cold') return `◌ Cache is cold: the next reply reads the whole chat again${f.cache.nextUsd === null ? '' : `, about ${round(f.cache.nextUsd)}`}.`
  if (f.cache?.mode === 'warm') return `↻ Cache warm for ${f.cache.minutesLeft} more minutes.${f.cache.extendUsd === null ? '' : ` A click keeps it warm for an hour, for ${round(f.cache.extendUsd)}.`}`
  return ''
}
