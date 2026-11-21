import { privManager } from './privmgr.js'
import { nextUid, getDB } from './db.js'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
// import { createHash, randomBytes } from 'crypto'
import { RegisterBody, LoginBody } from './types.js'
import { getAuthConfig } from './config.js'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Db } from 'mongodb'

const auth_config = getAuthConfig()

type RequestWithCookies = FastifyRequest & { cookies?: Record<string, string> }

let jwtSecret: string | null = null

export function setJWTSecret(secret: string): void {
    jwtSecret = secret
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

export async function getCurrentUser(request: FastifyRequest): Promise<Record<string, unknown> | null> {
    const userId = getUserIdFromRequest(request)
    if (userId === 0) return null
    const db = getDB()
    const user = await db.collection('users').findOne(
        { uid: userId },
        { projection: { password: 0, twofaSecret: 0, _id: 0 } }
    )
    if (!user) return null
    const safeUser: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(user)) {
        if (value instanceof Date) {
            safeUser[key] = value.toISOString()
        } else if (value instanceof Buffer) {
            safeUser[key] = value.toString('hex')
        } else if (value && typeof value === 'object' && '_bsontype' in value) {
            safeUser[key] = String(value)
        } else if (Array.isArray(value)) {
            safeUser[key] = value.map(v => v instanceof Date ? v.toISOString() : v)
        } else {
            safeUser[key] = value
        }
    }
    return safeUser
}

async function createUserRecord(
    db: Db,
    input: { username: string; email: string; password: string }
): Promise<number> {
    const userCount = await db.collection('users').countDocuments({ uid: { $gt: 0 } })
    const uid = await nextUid()
    const roles: string[] = []
    if (userCount === 0) {
        const superuserRole = await db.collection('roles').findOne({ name: 'superuser' })
        if (superuserRole) roles.push(superuserRole._id.toString())
    }
    if (roles.length === 0) {
        const defaultRole = await db.collection('roles').findOne({ name: 'default' })
        if (defaultRole) roles.push(defaultRole._id.toString())
    }
    await db.collection('users').insertOne({
        uid,
        username: input.username,
        email: input.email,
        password: input.password,
        roles,
        banned: false,
        createdAt: new Date()
    })
    return uid
}

export function getUserIdFromRequest(request: FastifyRequest): number {
    const req = request as RequestWithCookies
    const cookieToken = req.cookies?.[auth_config.cookieName]
    if (cookieToken) {
        const payload = verifyToken(cookieToken)
        if (payload) return payload.uid
    }
    const authHeader = request.headers.authorization
    if (!authHeader) return 0
    const token = authHeader.replace('Bearer ', '')
    const payload = verifyToken(token)
    return payload ? payload.uid : 0
}

export function setupAuthRoutes(server: FastifyInstance): void {
    server.post<{ Body: RegisterBody }>('/api/v1/register', async (request, reply) => {
        const { username, password, email } = request.body
        const db = getDB()
        const canRegister = await privManager.hasPriv(0, 'auth:register')
        if (!canRegister) {
            return reply.code(403).send({ success: false, error: 'Registration not allowed' })
        }
        const existingUser = await db.collection('users').findOne({
            $or: [{ username }, { email }]
        })
        if (existingUser) {
            return reply.code(409).send({ success: false, error: 'Username or email already exists' })
        }

        const hashedPassword = await bcrypt.hash(password, auth_config.saltRounds)
        const newUid = await createUserRecord(db, { username, email, password: hashedPassword })
        const token = signToken(newUid)
        return reply.code(201).send({ success: true, uid: newUid, username, token })
    })

    server.post<{ Body: LoginBody }>('/api/v1/login', async (request, reply) => {
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
        const canLogin = await privManager.hasPriv(user.uid, 'auth:login')
        if (!canLogin) {
            return reply.code(403).send({ success: false, error: 'User cannot login' })
        }
        const token = signToken(user.uid)
        return reply.code(200).send({ success: true, token, user: { uid: user.uid, username: user.username } })
    })

    server.post('/api/v1/logout', async (_request: FastifyRequest, /* reply: FastifyReply */) => {
        return { success: true }
    })
}

export function registerAuthPrivs(): void {
    privManager.registerPriv('auth:register', ['guest'])
    privManager.registerPriv('auth:login', ['default', 'superuser'])
}
