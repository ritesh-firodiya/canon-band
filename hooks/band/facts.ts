// Pure helpers for the band: no `$`, so the tests call them directly.

import { priceOf } from './prices'
import type { CacheFacts, Info, Level, ReplySize, UsageWindow } from './types'

export const TTL_MS = 60 * 60 * 1000
const LOW_AT = 20
const WARN_AT = 40
const PER_MILLION = 1_000_000
const NARROW_BELOW = 110

export const money = (usd: number): string => `$${usd.toFixed(2)}`
const CENT = 0.01
const round = (usd: number): string => (usd < CENT ? '<$0.01' : `$${usd.toFixed(2)}`)

export const isNarrow = (columns: number): boolean => columns < NARROW_BELOW

export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export interface WindowView {
  name: string
  left: number
  /** Only when it is low, since that is when it matters. */
  reset: string | null
  label: string
  level: Level
}

/** How much is left decides the colour: red when it is about to run out. */
export const levelOf = (left: number): Level => (left < LOW_AT ? 'bad' : left < WARN_AT ? 'warn' : 'ok')

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }

/** Usage left: the reset time only when it is low, since that is when it matters. */
export function windowViews(windows: readonly UsageWindow[], now: number): WindowView[] {
  return [...windows]
    .filter(w => NAMES[w.kind])
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))
    .map(w => {
      const left = Math.max(0, Math.round(100 - w.percentUsed))
      const level = levelOf(left)
      const name = NAMES[w.kind] as string
      const reset = level === 'bad' && w.resetsAt ? duration(Date.parse(w.resetsAt) - now) : null
      return { name, left, reset, label: `${name} ${left}%${reset ? ` ${reset}` : ''}`, level }
    })
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

/** Room left in the context window, from the share the engine says is used. */
export function contextView(percentUsed: number | null): WindowView | null {
  if (percentUsed === null) return null
  const left = Math.max(0, 100 - Math.round(percentUsed))
  return { name: 'ctx', left, reset: null, label: `ctx ${left}%`, level: levelOf(left) }
}

const about = (usd: number): string => `${usd < CENT ? '' : '~'}${round(usd)}`
export const extendLabel = (minutes: number, usd: number | null): string => `↻ ${minutes}m${usd === null ? '' : ` +${round(usd)}`}`
export const coldLabel = (usd: number | null): string => (usd === null ? '◌ cold' : `◌ cold ${about(usd)}`)

/** Extend shows only when it can do something: the cache is warm and no reply is running. */
export const canExtend = (view: CacheView | null, isBusy: boolean): boolean => view?.mode === 'warm' && !isBusy

export const SIZES: readonly ReplySize[] = ['S', 'M', 'L']
export const nextSize = (size: ReplySize): ReplySize => SIZES[(SIZES.indexOf(size) + 1) % SIZES.length] as ReplySize

const SIZE_WORDS: Record<ReplySize, string> = {
  S: 'one to three lines, no headings or tables',
  M: 'the answer first, then a short bullet list',
  L: 'the answer first, then steps, reasons and trade-offs',
}

/** What the model reads beside each prompt, so the size holds without touching the cached system prompt. */
export const replyRule = (size: ReplySize): string => `Reply size ${size}: write ${SIZE_WORDS[size]}. The person set this on the band; it overrides other length guidance.`

/** A typed prompt: not a slash command, and not one a mod sent. Only these carry the reply size. */
export const isTyped = (text: string, fromPlugin: boolean): boolean => !fromPlugin && text.trim() !== '' && !text.trimStart().startsWith('/')

export interface InfoFacts {
  isAwake: boolean
  size: ReplySize
  sessionUsd: number
  windows: readonly WindowView[]
  context: WindowView | null
  cache: CacheView | null
}

/** The one line a click on a short item shows, so a glyph never has to be guessed. */
export function infoLine(info: Info, f: InfoFacts): string {
  const limit = (name: string, what: string) => {
    const w = f.windows.find(entry => entry.name === name)
    return w ? `${name}: ${w.left}% of your ${what} limit is left.${w.reset ? ` It resets in ${w.reset}.` : ''}` : `${name}: no reading yet.`
  }
  if (info === 'awake') return f.isAwake ? '☀ Awake: this Mac will not sleep while this session is open. Click again to let it sleep.' : '☼ This session is not keeping the Mac awake. Click to keep it awake while this session is open.'
  if (info === 'size') return `Reply size ${f.size}: ${SIZE_WORDS[f.size]}. Click again for the next size.`
  if (info === 'cost') return `This session has spent ${money(f.sessionUsd)}.`
  if (info === '7D') return limit('7D', 'weekly')
  if (info === '5H') return limit('5H', 'five-hour')
  if (info === 'ctx') return f.context ? `ctx: ${f.context.left}% of the context window is left. Under ${LOW_AT}%, compact or start a new session.` : 'ctx: no reading yet.'
  if (f.cache?.mode === 'cold') return `◌ Cache is cold: the next reply reads the whole chat again${f.cache.nextUsd === null ? '' : `, about ${round(f.cache.nextUsd)}`}.`
  if (f.cache?.mode === 'warm') return `↻ Cache warm for ${f.cache.minutesLeft} more minutes.${f.cache.extendUsd === null ? '' : ` A click keeps it warm for an hour, for ${round(f.cache.extendUsd)}.`}`
  return ''
}
