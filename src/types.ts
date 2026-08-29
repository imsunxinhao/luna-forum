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
    registerPriv: (name: string, defaultRoles?: string[]) => void
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
    hasPriv: (userId: number, permId: string) => Promise<boolean>
    hasRole: (userId: number, roleName: string) => Promise<boolean>
    createRole: (name: string, nickname: string) => Promise<string>
    deleteRole: (roleId: string) => Promise<void>
    setPerm: (roleId: string, permId: string, value: boolean) => Promise<void>
    setUserRole: (userId: number, roleId: string) => Promise<void>
    removeUserRole: (userId: number, roleId: string) => Promise<void>
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
    avatar?: string
    banned: boolean
}

export interface Group {
    name: string
    priv: number
}

export interface RegisterBody {
    username: string
    password: string
    email: string
}

export interface LoginBody {
    username: string
    password: string
}

export interface Role {
    name: string
    nickname: string
    perms: Record<string, boolean>
}