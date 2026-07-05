export interface Plugin {
  name: string
  version: string
  deps: string[]
  init: (ctx: PluginContext) => Promise<void>
  activate: () => Promise<void>
  deactivate: () => Promise<void>
}

export interface PluginContext {
  kernel: KernelAPI
  registerHook: (hook: string, handler: HookHandler) => void
  registerCommand: (name: string, fn: CommandFn) => void
  registerPriv: (name: string, bitExpression: string, isDefault?: boolean) => void
}

export interface KernelAPI {
  getDB: () => any
  getServer: () => any
  getUserIdFromRequest: (request: any) => number
  callHook: (hook: string, ...args: any[]) => Promise<any[]>
  executeCommand: (name: string, ...args: any[]) => Promise<any>
  registerPlugin: (plugin: Plugin) => Promise<void>
  getConfig: (key: string, defaultValue?: any) => any
  setConfig: (key: string, value: any) => Promise<void>
  hasPriv: (userId: number, privBit: number) => Promise<boolean>
  getPrivBit: (name: string) => number
  banUser: (userId: number) => Promise<void>
  unbanUser: (userId: number) => Promise<void>
}

export type HookHandler = (...args: any[]) => Promise<any>
export type CommandFn = (...args: any[]) => Promise<any>

export interface PluginManifest {
  name: string
  version?: string
  main: string
  deps: string[]
}

export interface PluginConfig {
  name: string
  main: string
  deps: string[]
  version?: string
}

export interface User {
  uid: number
  username: string
  priv: number
  banned: boolean
}

export interface Group {
  name: string
  priv: number
}