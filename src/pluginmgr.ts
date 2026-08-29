import { Plugin, PluginContext, KernelAPI, PluginManifest } from './types.js'
import { hookManager } from './hookmgr.js'
import { getDB } from './db.js'
import { pathToFileURL } from 'url';
import { getDBConfigValue, setDBConfig } from './config.js'
import { privManager } from './privmgr.js'
import { getUserIdFromRequest } from './auth.js'
import { FastifyInstance } from 'fastify'
import nodePath from 'path'
import { promises } from 'fs'

class PluginManager {
    private plugins: Map<string, Plugin> = new Map()
    private commands: Map<string, Function> = new Map()
    private kernelAPI!: KernelAPI
    private server!: FastifyInstance

    private pluginEntries = [
        'index.js',
        'index.ts'
    ]

    setServer(server: FastifyInstance) {
        this.server = server
    }

    initKernelAPI() {
        this.kernelAPI = {
            getDB,
            getServer: () => this.server,
            getUserIdFromRequest,
            callHook: (...args) => hookManager.call(...args),
            executeCommand: (...args) => this.executeCommand(...args),
            registerPlugin: (plugin) => this.register(plugin),
            getConfig: (key, defaultValue) => getDBConfigValue(key, defaultValue),
            setConfig: (key, value) => setDBConfig(key, value),
            hasPriv: (userId, permId) => privManager.hasPriv(userId, permId),
            hasRole: (userId, roleName) => privManager.hasRole(userId, roleName),
            createRole: (name, nickname) => privManager.createRole(name, nickname),
            deleteRole: (roleId) => privManager.deleteRole(roleId),
            setPerm: (roleId, permId, value) => privManager.setPerm(roleId, permId, value),
            setUserRole: (userId, roleId) => privManager.setUserRole(userId, roleId),
            removeUserRole: (userId, roleId) => privManager.removeUserRole(userId, roleId),
            banUser: (userId) => privManager.banUser(userId),
            unbanUser: (userId) => privManager.unbanUser(userId)
        }
        return this.kernelAPI
    }

    async register(plugin: Plugin) {
        if (this.plugins.has(plugin.name)) {
            throw new Error(`Plugin ${plugin.name} already registered`)
        }

        for (const dep of plugin.deps) {
            if (!this.plugins.has(dep)) {
                throw new Error(`Dependency ${dep} not found for plugin ${plugin.name}`)
            }
        }

        const ctx: PluginContext = {
            kernel: this.kernelAPI,
            registerHook: (hook, handler) => hookManager.register(hook, handler),
            registerCommand: (name, fn) => { this.commands.set(name, fn) },
            registerPriv: (name, defaultRoles) => privManager.registerPriv(`${plugin.name}:${name}`, defaultRoles)
        }

        await plugin.init(ctx)

        this.plugins.set(plugin.name, plugin)
    }

    async activate(name: string) {
        const plugin = this.plugins.get(name)
        if (!plugin) throw new Error(`Plugin ${name} not found`)
        await plugin.activate()
    }

    async deactivate(name: string) {
        const plugin = this.plugins.get(name)
        if (!plugin) throw new Error(`Plugin ${name} not found`)
        await plugin.deactivate()
    }

    async executeCommand(name: string, ...args: unknown[]) {
        const cmd = this.commands.get(name)
        if (!cmd) throw new Error(`Command ${name} not found`)
        return cmd(...args)
    }

    async loadPlugin(manifest: PluginManifest) {
        const tryPaths = this.pluginEntries.map(e => nodePath.join(import.meta.dirname, '../', manifest.main, e))

        let path = ''
        for (const element of tryPaths) {
            try {
                await promises.access(element, promises.constants.F_OK)
                path = element
                break
            } catch { }
        }

        if (!path) {
            throw new Error(`Plugin entry file not found: ${manifest.main}`)
        }

        const mod = await import(pathToFileURL(path).href)
        const plugin = mod.default || mod
        await this.register(plugin)
    }

    getPlugin(name: string): Plugin | undefined {
        return this.plugins.get(name)
    }

    getPluginNames(): string[] {
        return Array.from(this.plugins.keys())
    }
}

export const pluginManager = new PluginManager()