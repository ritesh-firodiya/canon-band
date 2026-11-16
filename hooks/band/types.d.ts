export type Info = 'awake' | 'size' | 'cost' | '7D' | '5H' | 'ctx' | 'cache'
export type Level = 'ok' | 'warn' | 'bad'
export type ReplySize = 'S' | 'M' | 'L'

export type CacheFacts = { lastAt: number; tokens: number; model: string | null }

export type UsageWindow = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    canon: {
      windows: UsageWindow[]
      cache: CacheFacts | null
      taskUsd: number
      panel: Info | null
      isExtending: boolean
      contextUsed: number | null
      isAwake: boolean
      replySize: ReplySize
    }
  }
}
