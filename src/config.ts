import { readFileSync, existsSync } from 'fs'
import path, { resolve } from 'path'
import { createHash } from 'crypto'
import { getDB } from './db.js'
import { PluginConfig } from './types.js'

export interface AppConfig {
    mongodb: {
        uri: string
        dbName: string
    }
    site?: {
        name: string
        description: string
    }
    jwt_secret: string
    session_secret?: string
    smtp_host?: string
    smtp_port?: number
    smtp_user?: string
    smtp_pass?: string
    smtp_from?: string
    plugins: PluginConfig[]
}

export interface DBConfig extends Record<string, unknown> { }

export interface SiteConfig {
    name: string
    description: string
}

export interface SMTPConfig {
    host: string
    port: number
    user: string
    pass: string
    from: string
}

let appConfig: AppConfig

const dbConfig: DBConfig = {}

export async function loadConfig(defaultConfigPath: string = './config.json'): Promise<AppConfig> {
    const configFromEnv = process.env.CONFIG

    if (configFromEnv !== undefined) {
        try {
            appConfig = JSON.parse(configFromEnv) as AppConfig
        } catch (e) {
            throw new Error(`CONFIG 环境变量包含无效的 JSON: ${e instanceof Error ? e.message : String(e)}`)
        }
    } else {
        const fullPath = resolve(process.env.CONFIG_PATH ?? path.join(import.meta.dirname, '..', defaultConfigPath))

        if (!existsSync(fullPath)) {
            throw new Error(`Config file not found: ${fullPath}`)
        }

        const fileContent = readFileSync(fullPath, 'utf-8')
        try {
            appConfig = JSON.parse(fileContent) as AppConfig
        } catch (e) {
            throw new Error(`配置文件解析失败 (${fullPath}): ${e instanceof Error ? e.message : String(e)}`)
        }

        if (!appConfig.mongodb?.uri) {
            throw new Error('MongoDB URI is required in config.json')
        }
    }

    return appConfig
}

export async function loadDBConfig(): Promise<DBConfig> {
    const db = getDB()
    const configs = await db.collection('configs').find().toArray()

    configs.forEach((config) => {
        dbConfig[config.key] = config.value
    })

    return dbConfig
}

export function getConfig(): AppConfig {
    if (!appConfig) {
        throw new Error('Config not loaded')
    }
    return appConfig
}

export function getJWTSecret(): string {
    if (!appConfig) {
        throw new Error('Config not loaded')
    }
    if (!appConfig.jwt_secret) {
        throw new Error('jwt_secret must be configured in config.json or CONFIG environment variable')
    }
    return appConfig.jwt_secret
}

export function getSessionSecret(): string {
    if (appConfig?.session_secret) return appConfig.session_secret
    return createHash('sha256').update(appConfig!.jwt_secret + ':session-secret-derivation').digest('hex')
}

export function getPlugins(): PluginConfig[] {
    if (!appConfig) return []
    return appConfig.plugins || []
}

export function getDBConfig(): DBConfig {
    return dbConfig
}

export function getDBConfigValue<T>(key: string, defaultValue: T): T {
    return (dbConfig[key] as T) ?? defaultValue
}

export async function setDBConfig<T>(key: string, value: T): Promise<void> {
    const db = getDB()

    await db
        .collection('configs')
        .updateOne(
            { key },
            { $set: { key, value, updatedAt: new Date() } },
            { upsert: true }
        )

    dbConfig[key] = value
}

export async function deleteDBConfig(key: string): Promise<void> {
    const db = getDB()
    await db.collection('configs').deleteOne({ key })
    delete dbConfig[key]
}

export function getSiteConfig(): SiteConfig {
    return {
        name: getDBConfigValue<string>('site.name', appConfig?.site?.name ?? 'Luna Forum'),
        description: getDBConfigValue<string>('site.description', appConfig?.site?.description ?? '')
    }
}

export async function setSiteConfig(site: Partial<SiteConfig>): Promise<void> {
    if (site.name !== undefined) await setDBConfig('site.name', site.name)
    if (site.description !== undefined) await setDBConfig('site.description', site.description)
}

export function getSMTPConfig(): SMTPConfig | null {
    const host = getDBConfigValue<string>('smtp.host', appConfig?.smtp_host ?? '')
    if (!host) return null
    return {
        host,
        port: getDBConfigValue<number>('smtp.port', appConfig?.smtp_port ?? 587),
        user: getDBConfigValue<string>('smtp.user', appConfig?.smtp_user ?? ''),
        pass: getDBConfigValue<string>('smtp.pass', appConfig?.smtp_pass ?? ''),
        from: getDBConfigValue<string>('smtp.from', appConfig?.smtp_from ?? '')
    }
}

export async function setSMTPConfig(smtp: Partial<SMTPConfig>): Promise<void> {
    if (smtp.host !== undefined) await setDBConfig('smtp.host', smtp.host)
    if (smtp.port !== undefined) await setDBConfig('smtp.port', smtp.port)
    if (smtp.user !== undefined) await setDBConfig('smtp.user', smtp.user)
    if (smtp.pass !== undefined) await setDBConfig('smtp.pass', smtp.pass)
    if (smtp.from !== undefined) await setDBConfig('smtp.from', smtp.from)
}