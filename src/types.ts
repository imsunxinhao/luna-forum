import { FastifyInstance, FastifyRequest } from "fastify"
import { Db } from "mongodb"

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
  getDB: () => Db
  getServer: () => FastifyInstance
  getUserIdFromRequest: (request: FastifyRequest) => number
  callHook: (hook: string, ...args: unknown[]) => Promise<unknown[]>
  executeCommand: (name: string, ...args: unknown[]) => Promise<unknown>
  registerPlugin: (plugin: Plugin) => Promise<void>
  getConfig: (key: string, defaultValue?: unknown) => unknown
  setConfig: (key: string, value: unknown) => Promise<void>
  hasPriv: (userId: number, privBit: number) => Promise<boolean>
  getPrivBit: (name: string) => number
  banUser: (userId: number) => Promise<void>
  unbanUser: (userId: number) => Promise<void>
}

export type HookHandler = (...args: unknown[]) => Promise<unknown>
export type CommandFn = (...args: unknown[]) => Promise<unknown>

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