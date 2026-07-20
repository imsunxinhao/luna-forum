import { HookHandler } from './types'

class HookManager {
  private hooks: Map<string, HookHandler[]> = new Map()

  register(name: string, handler: HookHandler) {
    if (!this.hooks.has(name)) {
      this.hooks.set(name, [handler])
    } else {
      this.hooks.get(name)!.push(handler)
    }
  }

  async call(name: string, ...args: unknown[]) {
    const handlers = this.hooks.get(name)

    if (!handlers || handlers.length === 0) return []
    
    const results: unknown[] = []

    for (const handler of handlers) {
      const result = await handler(...args)
      results.push(result)
    }

    return results
  }

  remove(name: string, handler: HookHandler) {
    const handlers = this.hooks.get(name)

    if (handlers) {
      const idx = handlers.indexOf(handler)
      
      if (idx !== -1) handlers.splice(idx, 1)
    }
  }
}

export const hookManager = new HookManager()