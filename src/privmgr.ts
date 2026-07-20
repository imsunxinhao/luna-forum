import { getDB } from './db.js'
import { ObjectId } from 'mongodb'

class PrivManager {
  private privMap: Map<string, number> = new Map()
  private defaultBits: number[] = []

  register(name: string, bitExpression?: string, isDefault: boolean = false): void {
    if (this.privMap.has(name)) {
      throw new Error(`Priv ${name} already registered`)
    }
    
    let bit: number
    if (bitExpression) {
      bit = this.evaluateExpression(bitExpression)
    } else {
      bit = this.privMap.size
    }
    
    this.privMap.set(name, bit)

    if (isDefault) {
      this.defaultBits.push(bit)
    }
  }

  getDefaultPriv(): string {
    let priv = 0n
    for (const bit of this.defaultBits) {
      priv |= 1n << BigInt(bit)
    }
    return priv.toString()
  }

  private evaluateExpression(expression: string): number {
    const tokens = expression.trim().split(/\s+/)
    
    if (tokens.length === 1) {
      return parseInt(tokens[0])
    }
    
    let result = BigInt(this.parseToken(tokens[0]))
    
    for (let i = 1; i < tokens.length; i += 2) {
      const operator = tokens[i]
      const operand = BigInt(this.parseToken(tokens[i + 1]))
      
      switch (operator) {
        case '<<':
          result = result << operand
          break
        case '>>':
          result = result >> operand
          break
        case '|':
          result = result | operand
          break
        case '&':
          result = result & operand
          break
        case '^':
          result = result ^ operand
          break
        default:
          throw new Error(`Unknown operator: ${operator}`)
      }
    }
    
    return Number(result)
  }

  private parseToken(token: string): number {
    if (/^\d+$/.test(token)) {
      return parseInt(token)
    }
    
    if (this.privMap.has(token)) {
      return this.privMap.get(token)!
    }
    
    throw new Error(`Unknown token: ${token}`)
  }

  getBit(name: string): number {
    const bit = this.privMap.get(name)
    if (bit === undefined) {
      throw new Error(`Priv ${name} not found`)
    }
    return bit
  }

  async hasPriv(userId: number, privBit: number): Promise<boolean> {
    const db = getDB()
    const user = await db.collection('users').findOne({ uid: userId })
    
    if (!user) return false
    if (user.banned) return false
    
    const privStr = String(user.priv)
    if (privStr === '-1') return true
    
    const privBig = BigInt(privStr)
    const privValue = 1n << BigInt(privBit)
    return (privBig & privValue) === privValue
  }

  async getUserPriv(userId: number): Promise<string> {
    const db = getDB()
    const user = await db.collection('users').findOne({ uid: userId })
    if (!user) return '0'
    if (user.banned) return '0'
    return String(user.priv)
  }

  async setUserPriv(userId: number, priv: string) {
    const db = getDB()
    await db.collection('users').updateOne(
      { uid: userId },
      { $set: { priv, updatedAt: new Date() } }
    )
  }

  async addUserPriv(userId: number, privBit: number) {
    const db = getDB()
    const user = await db.collection('users').findOne({ uid: userId })
    if (!user) throw new Error('User not found')
    
    const privStr = String(user.priv)
    if (privStr === '-1') return
    
    const privBig = BigInt(privStr)
    const privValue = 1n << BigInt(privBit)
    const newPriv = (privBig | privValue).toString()
    await db.collection('users').updateOne(
      { uid: userId },
      { $set: { priv: newPriv, updatedAt: new Date() } }
    )
  }

  async removeUserPriv(userId: number, privBit: number) {
    const db = getDB()
    const user = await db.collection('users').findOne({ uid: userId })
    if (!user) throw new Error('User not found')
    
    const privStr = String(user.priv)
    if (privStr === '-1') return
    
    const privBig = BigInt(privStr)
    const privValue = 1n << BigInt(privBit)
    const newPriv = (privBig & ~privValue).toString()
    await db.collection('users').updateOne(
      { uid: userId },
      { $set: { priv: newPriv, updatedAt: new Date() } }
    )
  }

  async banUser(userId: number) {
    const db = getDB()
    if (userId === 0) throw new Error('Cannot ban guest user')
    
    await db.collection('users').updateOne(
      { uid: userId },
      { $set: { banned: true, bannedAt: new Date() } }
    )
  }

  async unbanUser(userId: number) {
    const db = getDB()
    await db.collection('users').updateOne(
      { uid: userId },
      { $set: { banned: false, unbannedAt: new Date() }, $unset: { bannedAt: '' } }
    )
  }

  async isBanned(userId: number): Promise<boolean> {
    const db = getDB()
    const user = await db.collection('users').findOne({ uid: userId })
    return user ? user.banned === true : false
  }

  async initGuestUser() {
    const db = getDB()
    
    const guestUser = await db.collection('users').findOne({ uid: 0 })
    if (!guestUser) {
      await db.collection('users').insertOne({
        uid: 0,
        username: 'guest',
        email: 'guest@forum.local',
        priv: '0',
        banned: false,
        createdAt: new Date()
      })
    }
  }
}

export const privManager = new PrivManager()