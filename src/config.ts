import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { getDB } from './db.js'
import { PluginConfig } from './types.js'

export interface AppConfig {
  mongodb: {
    uri: string
    dbName: string
  }
  jwt_secret: string
  plugins: PluginConfig[]
}

export interface DBConfig extends Record<string, unknown> {}

let appConfig: AppConfig

let dbConfig: DBConfig = {}

export async function loadConfig(configPath: string = './config.json'): Promise<AppConfig> {
  const fullPath = resolve(configPath)
  
  if (!existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`)
  }

  const fileContent = readFileSync(fullPath, 'utf-8')
  appConfig = JSON.parse(fileContent) as AppConfig

  if (!appConfig.mongodb?.uri) {
    throw new Error('MongoDB URI is required in config.json')
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
  return appConfig.jwt_secret || 'default-secret'
}

export function getPlugins(): PluginConfig[] {
  if (!appConfig) return []
  return appConfig.plugins || []
}

export function getDBConfig(): DBConfig {
  return dbConfig
}

export function getDBConfigValue<T>(key: string, defaultValue : T) {
  return (dbConfig[key] as T) ?? defaultValue
}

export async function setDBConfig<T>(key: string, value: T) {
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