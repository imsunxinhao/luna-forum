import { Plugin, PluginContext, KernelAPI, PluginManifest } from './types.js'
import { hookManager } from './hookmgr.js'
import { getDB } from './db.js'
import { getDBConfigValue, setDBConfig } from './config.js'
import { privManager } from './privmgr.js'
import { getUserIdFromRequest } from './auth.js'

class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private commands: Map<string, Function> = new Map()
  private kernelAPI: KernelAPI | null = null
  private server: any = null

  setServer(server: any): void {
    this.server = server
  }

  initKernelAPI(): KernelAPI {
    this.kernelAPI = {
      getDB,
      getServer: () => this.server,
      getUserIdFromRequest,
      callHook: (...args) => hookManager.call(...args),
      executeCommand: (...args) => this.executeCommand(...args),
      registerPlugin: (plugin) => this.register(plugin),
      getConfig: (key, defaultValue) => getDBConfigValue(key, defaultValue),
      setConfig: (key, value) => setDBConfig(key, value),
      hasPriv: (userId, privBit) => privManager.hasPriv(userId, privBit),
      getPrivBit: (name) => privManager.getBit(name),
      banUser: (userId) => privManager.banUser(userId),
      unbanUser: (userId) => privManager.unbanUser(userId)
    }
    return this.kernelAPI
  }

  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} already registered`)
    }

    for (const dep of plugin.deps) {
      if (!this.plugins.has(dep)) {
        throw new Error(`Dependency ${dep} not found for plugin ${plugin.name}`)
      }
    }

    const ctx: PluginContext = {
      kernel: this.kernelAPI!,
      registerHook: (hook, handler) => hookManager.register(hook, handler),
      registerCommand: (name, fn) => this.commands.set(name, fn),
      registerPriv: (name, bitExpression, isDefault) => privManager.register(name, bitExpression, isDefault)
    }

    await plugin.init(ctx)
    this.plugins.set(plugin.name, plugin)
  }

  async activate(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) throw new Error(`Plugin ${name} not found`)
    await plugin.activate()
  }

  async deactivate(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) throw new Error(`Plugin ${name} not found`)
    await plugin.deactivate()
  }

  async executeCommand(name: string, ...args: any[]): Promise<any> {
    const cmd = this.commands.get(name)
    if (!cmd) throw new Error(`Command ${name} not found`)
    return cmd(...args)
  }

  async loadPlugin(manifest: PluginManifest): Promise<void> {
    const mod = await import('../' + manifest.main)
    const plugin: Plugin = mod.default || mod
    await this.register(plugin)
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name)
  }
}

export const pluginManager = new PluginManager()