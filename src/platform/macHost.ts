export interface HostResult {
  ok: boolean
  error?: string
  code?: string
}

declare function fiotpHostInvoke(method: string, payload: string): string

function hasNativeHost(): boolean {
  return typeof fiotpHostInvoke === 'function'
}

export class MacHost {
  static readonly available = hasNativeHost()

  static invoke(method: string, payload: Record<string, unknown> = {}): string {
    if (!hasNativeHost()) {
      throw new Error('Bu işlem yalnız FiOTP macOS uygulamasında kullanılabilir.')
    }
    const raw = fiotpHostInvoke(method, JSON.stringify(payload))
    const result = JSON.parse(raw) as HostResult
    if (!result.ok) throw new Error(result.error || 'macOS işlemi başarısız oldu')
    return raw
  }

  static copy(text: string): void {
    if (hasNativeHost()) {
      this.invoke('clipboard.copy', { text })
      return
    }
    // Web is deliberately a preview target. Clipboard is best-effort there.
    const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText(v: string): void } } }).navigator
    nav?.clipboard?.writeText(text)
  }
}
