import { privManager } from './privmgr.js'
import { nextUid, getDB } from './db.js'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { RegisterBody, LoginBody } from './types.js'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

const SALT_ROUNDS = 10
const COOKIE_NAME = 'client_key'
const TOKEN_EXPIRES = 7 * 24 * 60 * 60

type RequestWithCookies = FastifyRequest & { cookies?: Record<string, string> }

let jwtSecret: string | null = null

export function setJWTSecret(secret: string): void {
    jwtSecret = secret
}

function isFormRequest(request: FastifyRequest): boolean {
    const headers = request.headers
    const contentType = headers['content-type']
    return typeof contentType === 'string' && contentType.includes('application/x-www-form-urlencoded')
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

function setAuthCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: TOKEN_EXPIRES
    })
}

function clearAuthCookie(reply: FastifyReply): void {
    reply.clearCookie(COOKIE_NAME, { path: '/' })
}

export function getUserIdFromRequest(request: FastifyRequest): number {
    const req = request as RequestWithCookies
    const cookieToken = req.cookies?.[COOKIE_NAME]
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
            if (isFormRequest(request)) {
                request.flash('error', '您没有权限注册账户')
                return reply.redirect('/register')
            }
            return reply.code(403).send({ success: false, error: 'Registration not allowed' })
        }
        const existingUser = await db.collection('users').findOne({
            $or: [{ username }, { email }]
        })
        if (existingUser) {
            if (isFormRequest(request)) {
                request.flash('error', '用户名或邮箱已存在')
                return reply.redirect('/register')
            }
            return reply.code(409).send({ success: false, error: 'Username or email already exists' })
        }
        const userCount = await db.collection('users').countDocuments({ uid: { $gt: 0 } })
        const newUid = await nextUid()

        const roles: string[] = []
        if (userCount === 0) {
            const superuserRole = await db.collection('roles').findOne({ name: 'superuser' })
            if (superuserRole) roles.push(superuserRole._id.toString())
        }
        if (roles.length === 0) {
            const defaultRole = await db.collection('roles').findOne({ name: 'default' })
            if (defaultRole) roles.push(defaultRole._id.toString())
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)
        await db.collection('users').insertOne({
            uid: newUid,
            username,
            email,
            password: hashedPassword,
            roles,
            banned: false,
            createdAt: new Date()
        })
        const token = signToken(newUid)
        setAuthCookie(reply, token)
        if (isFormRequest(request)) return reply.redirect('/')
        return reply.code(201).send({ success: true, uid: newUid, username, token })
    })

    server.post<{ Body: LoginBody }>('/api/v1/login', async (request, reply) => {
        const { username, password } = request.body
        const db = getDB()
        const user = await db.collection('users').findOne({ username })
        if (!user) {
            if (isFormRequest(request)) {
                request.flash('error', '用户名或密码错误')
                return reply.redirect('/login')
            }
            return reply.code(401).send({ success: false, error: 'Invalid credentials' })
        }
        const passwordMatch = await bcrypt.compare(password, user.password)
        if (!passwordMatch) {
            if (isFormRequest(request)) {
                request.flash('error', '用户名或密码错误')
                return reply.redirect('/login')
            }
            return reply.code(401).send({ success: false, error: 'Invalid credentials' })
        }
        const canLogin = await privManager.hasPriv(user.uid, 'auth:login')
        if (!canLogin) {
            if (isFormRequest(request)) {
                request.flash('error', '用户无法登录')
                return reply.redirect('/login')
            }
            return reply.code(403).send({ success: false, error: 'User cannot login' })
        }
        const token = signToken(user.uid)
        setAuthCookie(reply, token)
        if (isFormRequest(request)) {
            request.flash('success', '登录成功')
            return reply.redirect('/')
        }
        return reply.code(200).send({ success: true, token, user: { uid: user.uid, username: user.username } })
    })

    server.post('/api/v1/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
        clearAuthCookie(reply)
        if (isFormRequest(_request)) return reply.redirect(_request.headers.referer ?? '/')
        return { success: true }
    })
}

export function registerAuthPrivs(): void {
    privManager.registerPriv('auth:register', ['guest'])
    privManager.registerPriv('auth:login', ['default', 'superuser'])
}