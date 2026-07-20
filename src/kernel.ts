import { connect, disconnect } from './db.js'
import { pluginManager } from './pluginmgr.js'
import { hookManager } from './hookmgr.js'
import { loadConfig, loadDBConfig } from './config.js'
import { privManager } from './privmgr.js'
import { registerAuthPrivs, initGuestPriv, setupAuthRoutes, setJWTSecret } from './auth.js'
import Fastify, { FastifyInstance } from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'

export class Kernel {
  private server!: FastifyInstance

  private started: boolean = false

  async boot(configPath?: string) {
    const config = await loadConfig(configPath)

    setJWTSecret(config.jwt_secret || 'default-secret')

    await connect(config.mongodb.uri, config.mongodb.dbName || 'forum')

    await privManager.initGuestUser()

    registerAuthPrivs()

    await initGuestPriv()

    await loadDBConfig()

    this.server = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>()

    this.server.get('/api/v1/health', async () => {
      return { status: 'ok', plugins: Array.from(pluginManager['plugins'].keys()) }
    })

    setupAuthRoutes(this.server)

    await hookManager.call('kernel:beforeBoot')
    this.started = true
    await hookManager.call('kernel:afterBoot')

    return config
  }

  async start(port?: number) {
    if (!this.started) throw new Error('Kernel not booted')

    const dbPort = port || await (async () => {
      try {
        const { getDBConfigValue } = await import('./config.js')
        return getDBConfigValue('server.port', 3000)
      } catch {
        return 3000
      }
    })()

    await hookManager.call('kernel:beforeStart')

    await this.server.listen({ port: dbPort, host: '0.0.0.0' })
    console.log(`Forum core running on port ${dbPort}`)

    await hookManager.call('kernel:afterStart')
  }

  async stop() {
    await hookManager.call('kernel:beforeStop')

    if (this.server) {
      await this.server.close()
    }
    await disconnect()

    await hookManager.call('kernel:afterStop')
    this.started = false
  }

  getServer() {
    return this.server
  }
}