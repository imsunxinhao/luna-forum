import { MongoClient, Db } from 'mongodb'

let client: MongoClient
let db: Db

export async function connect(uri: string, dbName: string): Promise<Db> {
  if(!uri || !dbName) {
    throw new Error('MongoDB URI and database name must be provided')
  }
  client = new MongoClient(uri)
  await client.connect()
  db = client.db(dbName)
  return db
}

export function getDB(): Db {
  if (!db) throw new Error('Database not connected')
  return db
}

export async function disconnect() {
  if (client) await client.close()
}