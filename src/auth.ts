import { privManager } from './privmgr.js'
import { getDB } from './db.js'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

const PRIV_REGISTER_ACCOUNT = 0
const PRIV_LOGIN = 1
const SALT_ROUNDS = 10

let jwtSecret: string | null = null

export function setJWTSecret(secret: string): void {
  jwtSecret = secret
}

export function registerAuthPrivs(): void {
  privManager.register('PRIV_REGISTER_ACCOUNT', String(PRIV_REGISTER_ACCOUNT))
  privManager.register('PRIV_LOGIN', String(PRIV_LOGIN), true)
}

export function signToken(userId: number): string {
  if (!jwtSecret) throw new Error('JWT Secret not set')
  return jwt.sign({ uid: userId }, jwtSecret, { expiresIn: '7d' })
}

export function verifyToken(token: string): { uid: number } | null {
  if (!jwtSecret) throw new Error('JWT Secret not set')
  try {
    return jwt.verify(token, jwtSecret) as { uid: number }
  } catch {
    return null
  }
}

export function getUserIdFromRequest(request): number {
  const authHeader = request.headers.authorization
  if (!authHeader) return 0

  const token = authHeader.replace('Bearer ', '')
  const payload = verifyToken(token)
  return payload ? payload.uid : 0
}

export async function initGuestPriv() {
  const db = getDB()
  const guest = await db.collection('users').findOne({ uid: 0 })
  const guestPriv = BigInt(guest ? String(guest.priv) : '0')
  const registerPriv = guestPriv | (1n << BigInt(PRIV_REGISTER_ACCOUNT))
  await db.collection('users').updateOne(
    { uid: 0 },
    { $set: { priv: registerPriv.toString() } }
  )
}

export function setupAuthRoutes(server: FastifyInstance): void {
  server.post('/api/v1/register', async (request, reply) => {
    const { username, password, email } = request.body
    const db = getDB()

    const canRegister = await privManager.hasPriv(0, PRIV_REGISTER_ACCOUNT)
    if (!canRegister) {
      return reply.code(403).send({ success: false, error: 'Registration not allowed' })
    }

    const existingUser = await db.collection('users').findOne({
      $or: [{ username }, { email }]
    })
    if (existingUser) {
      return reply.code(409).send({ success: false, error: 'Username or email already exists' })
    }

    const userCount = await db.collection('users').countDocuments({ uid: { $gt: 0 } })
    const maxUser = await db.collection('users').find().sort({ uid: -1 }).limit(1).toArray()
    const newUid = maxUser.length > 0 ? maxUser[0].uid + 1 : 1

    let privValue: string
    if (userCount === 0) {
      privValue = '-1'
    } else {
      privValue = privManager.getDefaultPriv()
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)

    await db.collection('users').insertOne({
      uid: newUid,
      username,
      email,
      password: hashedPassword,
      priv: privValue,
      banned: false,
      createdAt: new Date()
    })

    const token = signToken(newUid)
    return reply.code(201).send({ success: true, uid: newUid, username, token })
  })

  server.post('/api/v1/login', async (request, reply) => {
    const { username, password } = request.body
    const db = getDB()

    const user = await db.collection('users').findOne({ username })
    if (!user) {
      return reply.code(401).send({ success: false, error: 'Invalid credentials' })
    }

    const passwordMatch = await bcrypt.compare(password, user.password)
    if (!passwordMatch) {
      return reply.code(401).send({ success: false, error: 'Invalid credentials' })
    }

    const canLogin = await privManager.hasPriv(user.uid, PRIV_LOGIN)
    if (!canLogin) {
      return reply.code(403).send({ success: false, error: 'User cannot login' })
    }

    const token = signToken(user.uid)
    return { success: true, token, user: { uid: user.uid, username: user.username } }
  })
}

export { PRIV_REGISTER_ACCOUNT, PRIV_LOGIN }