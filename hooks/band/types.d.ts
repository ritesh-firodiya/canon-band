export type Info = 'awake' | 'mode' | 'size' | 'cost' | '7D' | '5H' | 'Spend' | 'month' | 'effort' | 'ctx' | 'cache'
export type Level = 'ok' | 'warn' | 'bad'
export type ReplySize = 'S' | 'M' | 'L'
export type Mode = 'manual' | 'assisted'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku'

/** This Mac's spend in one month, by session, so a resumed session counts once. */
export type MonthSpend = { month: string; sessions: Record<string, number> }

export type Blocked = { command: string; what: string }

export type CacheFacts = { lastAt: number; tokens: number; model: string | null }

export type ContextFacts = { tokens: number; window: number; percent: number }

export type ContextRow = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

export type UsageWindow = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'canon-band': {
      windows: UsageWindow[]
      cache: CacheFacts | null
      taskUsd: number
      panel: Info | null
      isExtending: boolean
      context: ContextFacts | null
      breakdown: ContextRow[] | null
      isAwake: boolean
      replySize: ReplySize
      mode: Mode
      recommendation: string | null
      blocked: Blocked | null
      effort: Effort | null
      seenEffort: Effort | null
      monthUsd: number
      isPicking: boolean
    }
  }
}
