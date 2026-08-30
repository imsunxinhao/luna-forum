import { connect, disconnect, initUidCounter } from './db.js'
import { pluginManager } from './pluginmgr.js'
import { hookManager } from './hookmgr.js'
import { loadConfig, loadDBConfig, getSessionSecret } from './config.js'
import { privManager } from './privmgr.js'
import { registerAuthPrivs, setupAuthRoutes, setJWTSecret } from './auth.js'
import Fastify, { FastifyInstance } from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { fastifyCookie } from '@fastify/cookie'
import fastifyFormbody from '@fastify/formbody';
import fastifyFlash from '@fastify/flash'
import fastifySession from '@fastify/session'

export class Kernel {
    private server!: FastifyInstance

    private started: boolean = false

    async boot(configPath?: string) {
        const config = await loadConfig(configPath)

        setJWTSecret(config.jwt_secret)

        await connect(config.mongodb.uri, config.mongodb.dbName || 'forum')

        registerAuthPrivs()

        await privManager.initGuestUser()

        await loadDBConfig()

        const isDev = process.env.NODE_ENV !== 'production'

        await initUidCounter();

        this.server = Fastify({
            logger: isDev
                ? {
                    transport: {
                        target: 'pino-pretty',
                        options: {
                            translateTime: 'HH:MM:ss Z',
                            ignore: 'pid,hostname',
                            colorize: true,
                            singleLine: true
                        }
                    }
                }
                : true
        }).withTypeProvider<TypeBoxTypeProvider>()

        this.server.register(fastifyFormbody);

        this.server.register(fastifyCookie, {
            secret: config.jwt_secret,
            hook: 'onRequest'
        })

        const sessionSecret = getSessionSecret()

        this.server.register(fastifySession, {
            secret: sessionSecret,
            cookie: { secure: process.env.NODE_ENV === 'production' }
        });

        this.server.register(fastifyFlash);
        
        this.server.get('/api/v1/health', async () => {
            return { status: 'ok', plugins: pluginManager.getPluginNames() }
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

        const host = await (async () => {
            try {
                const { getDBConfigValue } = await import('./config.js')
                return getDBConfigValue('server.host', '0.0.0.0') as string
            } catch {
                return '0.0.0.0'
            }
        })()

        await hookManager.call('kernel:beforeStart')

        this.server.log.info(`          Luna Forum`);

        this.server.log.info(`================================`)

        await this.server.listen({ port: dbPort, host })

        this.server.log.info(`================================`)

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