// Pure helpers for the band: no `$`, so the tests call them directly.

import { priceOf } from './prices'
import type { CacheFacts, ContextFacts, ContextRow, Effort, Family, Info, Level, MonthSpend, ReplySize, UsageWindow } from './types'

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

/** The time left, in its biggest unit: 3d, 20h, 45m. */
export function timeLeft(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

export interface WindowView {
  /** Which window: 7D or 5H, the key a click shows. */
  name: string
  used: number
  /** When it resets, in full; null before the engine says. */
  reset: string | null
  label: string
  level: Level
}

/** How much is used decides the colour: red when it is about to run out. */
export const levelOf = (used: number): Level => (used >= HIGH_AT ? 'bad' : used >= WARN_AT ? 'warn' : 'ok')

// spend_limit comes from a Claude gateway that reports the company's spend limit, as on an enterprise Bedrock setup.
const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'Spend' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1, spend_limit: 2 }

/** Usage so far, rising from 0, led by the time left until the window resets: `3d 59%`, `2h 4%`. */
export function windowViews(windows: readonly UsageWindow[], now: number): WindowView[] {
  return [...windows]
    .filter(w => NAMES[w.kind])
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))
    .map(w => {
      const used = Math.min(100, Math.max(0, Math.round(w.percentUsed)))
      const level = levelOf(used)
      const name = NAMES[w.kind] as string
      const ms = w.resetsAt ? Date.parse(w.resetsAt) - now : Number.NaN
      const known = Number.isFinite(ms)
      return { name, used, reset: known ? duration(ms) : null, label: `${known ? timeLeft(ms) : name} ${used}%`, level }
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

/** What fills the window, largest first, then what is free: the lines a click on ctx shows. */
export function breakdownLine(rows: readonly ContextRow[]): string {
  const used = rows.filter(r => r.kind === 'used' && r.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const free = rows.filter(r => r.kind === 'free' || r.kind === 'buffer')
  const shown = [...used, ...free]
  const width = Math.max(0, ...shown.map(r => r.name.length))
  // One row per line, the numbers lined up after the longest name.
  return shown.map(r => `  ${r.name.padEnd(width)}  ${tokens(r.tokens).padStart(5)}`).join('\n')
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

/** What the model reads beside each prompt, so the size holds without touching the cached system prompt. */
export const replyRule = (size: ReplySize): string =>
  `Reply size ${size}: write ${SIZE_WORDS[size]}, in plain words, the way a person talks. The person set this on the band; it overrides other length guidance.`

// The person's own message: Enter at the prompt, or the phone through Remote Control. Never an SDK run, a schedule or another agent.
const PERSON = new Set(['composer', 'bridge'])

/** A prompt the person typed, not a slash command. Only these carry the reply rule. */
export const isTyped = (text: string, origin: string): boolean => PERSON.has(origin) && text.trim() !== '' && !text.trimStart().startsWith('/')

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const nextEffort = (effort: Effort): Effort => EFFORTS[(EFFORTS.indexOf(effort) + 1) % EFFORTS.length] as Effort
export const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort)

export const FAMILIES: readonly Family[] = ['fable', 'opus', 'sonnet', 'haiku']
// The latest of each family, to price a switch. shortcut: written by hand, add a family's new model when it ships.
const LATEST: Record<Family, string> = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' }

/** The family a model id runs, Bedrock and dated ids too; null for one outside them. */
export const familyOf = (model: string): Family | null => (/fable|mythos/.test(model) ? 'fable' : (FAMILIES.find(f => model.includes(f)) ?? null))

/** What the first message after a switch costs: the whole chat is written to the new model's cache. */
export function switchUsd(tokens: number, to: Family): number | null {
  const price = priceOf(LATEST[to], tokens)
  return price && tokens > 0 ? (tokens * price.write1h) / PER_MILLION : null
}

export const switchLabel = (to: Family, usd: number | null): string => (usd === null ? to : `${to} ~${round(usd)}`)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `2026-11`, in this Mac's own calendar. */
export const monthOf = (now: number): string => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** This session's spend added to the month's; a new month starts from zero. */
export function addSpend(store: MonthSpend | null, month: string, sessionId: string, usd: number): MonthSpend {
  const sessions = store?.month === month ? store.sessions : {}
  return { month, sessions: { ...sessions, [sessionId]: Math.max(usd, sessions[sessionId] ?? 0) } }
}

export const monthTotal = (store: MonthSpend | null, month: string): number => (store?.month === month ? Object.values(store.sessions).reduce((a, b) => a + b, 0) : 0)

export interface MonthView {
  label: string
  level: Level
}

/** `Nov $212`, or `Nov $212/$1000` with a budget set, coloured by its share of the budget. */
export function monthView(month: string, usd: number, budget: number | null): MonthView {
  const name = MONTHS[Number(month.slice(5)) - 1] ?? month
  const spent = `$${Math.round(usd)}`
  if (!budget) return { label: `${name} ${spent}`, level: 'ok' }
  return { label: `${name} ${spent}/$${Math.round(budget)}`, level: levelOf((usd / budget) * 100) }
}

export interface InfoFacts {
  isAwake: boolean
  size: ReplySize
  sessionUsd: number
  windows: readonly WindowView[]
  context: ContextView | null
  breakdown: readonly ContextRow[] | null
  cache: CacheView | null
  effort: Effort | null
  monthUsd: number
  budget: number | null
}

/** The one line a click on a short item shows, so a glyph never has to be guessed. */
export function infoLine(info: Info, f: InfoFacts): string {
  const limit = (name: string, what: string) => {
    const w = f.windows.find(entry => entry.name === name)
    return w ? `${what}: ${w.used}% used.${w.reset ? ` It resets in ${w.reset}.` : ''}` : `${what}: no reading yet.`
  }
  if (info === 'awake') return f.isAwake ? '☀ Awake: this Mac will not sleep while this session is open. Click again to let it sleep.' : '☼ This session is not keeping the Mac awake. Click to keep it awake while this session is open.'
  if (info === 'size') return `Reply size ${f.size}: ${SIZE_WORDS[f.size]}. Click again for the next size.`
  if (info === 'cost') return `This session has spent ${money(f.sessionUsd)}.`
  if (info === '7D') return limit('7D', 'Weekly limit')
  if (info === '5H') return limit('5H', '5-hour limit')
  if (info === 'Spend') return limit('Spend', 'Spend limit')
  if (info === 'effort') return f.effort ? `Effort ${f.effort}: how hard the model thinks. Click again for the next one; the cache holds.` : "Effort: the model's own default. Click to set one; the cache holds."
  if (info === 'month') return `This Mac has spent ${money(f.monthUsd)} this month, in sessions with canon-band.${f.budget ? ` Your limit is $${Math.round(f.budget)}, set in the plugin settings; other machines and people are not counted.` : ' Set your monthly limit in the plugin settings to see it against that.'}`
  if (info === 'ctx') {
    if (!f.context) return 'ctx: no reading yet.'
    const head = `ctx: ${tokens(f.context.tokens)} of ${tokens(f.context.window)} tokens used (${f.context.percent}%).${f.context.percent >= HIGH_AT ? ' Compact or start a new session.' : ''}`
    return f.breakdown?.length ? `${head}\n${breakdownLine(f.breakdown)}` : head
  }
  if (f.cache?.mode === 'cold') return `◌ Cache is cold: the next reply reads the whole chat again${f.cache.nextUsd === null ? '' : `, about ${round(f.cache.nextUsd)}`}.`
  if (f.cache?.mode === 'warm') return `↻ Cache warm for ${f.cache.minutesLeft} more minutes.${f.cache.extendUsd === null ? '' : ` A click keeps it warm for an hour, for ${round(f.cache.extendUsd)}.`}`
  return ''
}
