import { privManager } from './privmgr.js'
import { nextUid, getDB } from './db.js'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'crypto'
import { Type, type Static } from '@sinclair/typebox'
import { RegisterBody, LoginBody } from './types.js'
import { getSMTPConfig, getSiteConfig, getSiteOrigin } from './config.js'
import { sendMail } from './mail.js'
import { renderRegisterMail, renderResetMail, type MailLang } from './mail-templates.js'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Db } from 'mongodb'
const SALT_ROUNDS = 10
const COOKIE_NAME = 'client_key'
const TOKEN_EXPIRES = 7 * 24 * 60 * 60

/** 注册确认链接有效期 */
const REGISTER_TOKEN_TTL = 24 * 60 * 60 * 1000
/** 密码重置链接有效期 */
const RESET_TOKEN_TTL = 60 * 60 * 1000
/** 同一邮箱两次发信的最小间隔，避免注册/找回密码接口被当成发信器滥用 */
const RESEND_WINDOW = 60 * 1000

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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** 浏览器表单提交走闪现消息 + 重定向，接口调用返回 JSON */
function wantsJson(request: FastifyRequest): boolean {
    return (request.headers.accept ?? '').includes('application/json')
}

function newToken(): string {
    return randomBytes(32).toString('hex')
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

function mailLang(request: FastifyRequest): MailLang {
    return (request.headers['accept-language'] ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * 拼邮件里的链接：优先使用配置的站点地址（site.url），
 * 未配置时才回落到请求 Host，并且只接受安全格式，
 * 避免 Host 头注入把密码重置链接指向攻击者域名。
 */
function buildLink(request: FastifyRequest, pathname: string, token: string): string {
    const configured = getSiteOrigin()
    const host = request.headers.host ?? ''
    const hostOk = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9a-fA-F:.]+\])(?::\d{1,5})?$/.test(host)
    const origin = configured || (hostOk ? `${request.protocol}://${host}` : 'http://localhost')
    return `${origin}${pathname}?token=${encodeURIComponent(token)}`
}

/** 建号：第一个用户拿 superuser，其余拿 default —— 与直接注册保持一致 */
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

function respondRegistrationMail(request: FastifyRequest, reply: FastifyReply, email: string): FastifyReply {
    if (isFormRequest(request)) {
        request.flash('success', 'flash.registerMailSent')
        return reply.redirect('/register')
    }
    return reply.code(201).send({ success: true, mailSent: true, email })
}

/**
 * SMTP 模式下的注册：不直接建号，而是落一条待注册记录，
 * 把带令牌的注册链接发到用户邮箱，由 /api/v1/register/verify 完成建号。
 */
async function beginEmailRegistration(
    request: FastifyRequest,
    reply: FastifyReply,
    input: { username: string; password: string; email: string }
): Promise<FastifyReply> {
    const db = getDB()

    if (!isEmail(input.email)) {
        if (isFormRequest(request)) {
            request.flash('error', 'flash.invalidEmail')
            return reply.redirect('/register')
        }
        return reply.code(400).send({ success: false, error: 'Invalid email address' })
    }

    // 一分钟内已发过：不重复打扰，用户收到的那封链接依然有效
    const recent = await db.collection('pending_registrations').findOne({ email: input.email })
    if (recent && Date.now() - new Date(recent.createdAt).getTime() < RESEND_WINDOW) {
        return respondRegistrationMail(request, reply, input.email)
    }

    const token = newToken()
    const tokenHash = hashToken(token)
    const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS)

    await db.collection('pending_registrations').deleteMany({
        $or: [{ username: input.username }, { email: input.email }]
    })
    await db.collection('pending_registrations').insertOne({
        tokenHash,
        username: input.username,
        email: input.email,
        password: hashedPassword,
        expiresAt: new Date(Date.now() + REGISTER_TOKEN_TTL),
        createdAt: new Date()
    })

    const site = getSiteConfig()
    const link = buildLink(request, '/api/v1/register/verify', token)
    const mail = renderRegisterMail(mailLang(request), site.name, input.username, link)
    try {
        await sendMail({
            to: input.email,
            subject: mail.subject,
            text: mail.text,
            html: mail.html
        })
    } catch (error) {
        await db.collection('pending_registrations').deleteOne({ tokenHash })
        if (isFormRequest(request)) {
            request.flash('error', 'flash.mailSendFailed')
            return reply.redirect('/register')
        }
        return reply.code(502).send({ success: false, error: errorMessage(error) })
    }

    return respondRegistrationMail(request, reply, input.email)
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
                request.flash('error', 'flash.noPrivRegister')
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
        // 配置了 SMTP：先验证邮箱，注册确认信发到邮箱后才建号
        if (getSMTPConfig()) {
            return beginEmailRegistration(request, reply, { username, password, email })
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)
        const newUid = await createUserRecord(db, { username, email, password: hashedPassword })
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
                request.flash('error', 'flash.invalidCredentials')
                return reply.redirect('/login')
            }
            return reply.code(401).send({ success: false, error: 'Invalid credentials' })
        }
        const passwordMatch = await bcrypt.compare(password, user.password)
        if (!passwordMatch) {
            if (isFormRequest(request)) {
                request.flash('error', 'flash.invalidCredentials')
                return reply.redirect('/login')
            }
            return reply.code(401).send({ success: false, error: 'Invalid credentials' })
        }
        const canLogin = await privManager.hasPriv(user.uid, 'auth:login')
        if (!canLogin) {
            if (isFormRequest(request)) {
                request.flash('error', 'flash.banned')
                return reply.redirect('/login')
            }
            return reply.code(403).send({ success: false, error: 'User cannot login' })
        }
        const token = signToken(user.uid)
        setAuthCookie(reply, token)
        if (isFormRequest(request)) {
            request.flash('success', 'flash.loginSuccess')
            return reply.redirect('/')
        }
        return reply.code(200).send({ success: true, token, user: { uid: user.uid, username: user.username } })
    })

    server.post('/api/v1/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
        clearAuthCookie(reply)
        if (isFormRequest(_request)) return reply.redirect(_request.headers.referer ?? '/')
        return { success: true }
    })

    // 点开注册邮件里的链接：校验令牌后建号
    server.get('/api/v1/register/verify', async (request, reply) => {
        const { token } = request.query as { token?: string }
        const json = wantsJson(request)
        const invalid = (flashKey: string, error: string) => {
            if (json) return reply.code(400).send({ success: false, error })
            request.flash('error', flashKey)
            return reply.redirect('/register')
        }

        if (!token) return invalid('flash.verifyInvalid', 'Invalid verification link')

        const db = getDB()
        const pending = await db.collection('pending_registrations').findOne({ tokenHash: hashToken(token) })
        const expiresAt = pending?.expiresAt ? new Date(pending.expiresAt).getTime() : 0
        if (!pending || expiresAt < Date.now()) {
            return invalid('flash.verifyInvalid', 'Invalid or expired verification link')
        }

        await db.collection('pending_registrations').deleteOne({ tokenHash: pending.tokenHash })

        const existing = await db.collection('users').findOne({
            $or: [{ username: pending.username }, { email: pending.email }]
        })
        if (existing) return invalid('flash.userExists', 'Username or email already exists')

        const uid = await createUserRecord(db, {
            username: String(pending.username),
            email: String(pending.email),
            password: String(pending.password)
        })

        if (json) return reply.code(200).send({ success: true, uid, username: pending.username })
        request.flash('success', 'flash.verifySuccess')
        return reply.redirect('/login')
    })

    const forgotBodySchema = Type.Object({
        email: Type.String({ minLength: 3, maxLength: 320 })
    })
    server.post<{ Body: Static<typeof forgotBodySchema> }>('/api/v1/password/forgot', {
        schema: { body: forgotBodySchema }
    }, async (request, reply) => {
        if (!getSMTPConfig()) {
            if (isFormRequest(request)) {
                request.flash('error', 'flash.smtpNotConfigured')
                return reply.redirect('/login')
            }
            return reply.code(503).send({ success: false, error: 'SMTP is not configured' })
        }

        const email = request.body.email.trim()
        const db = getDB()
        const user = await db.collection('users').findOne({ email })

        if (user) {
            const recent = await db.collection('password_resets').findOne({ userId: user.uid })
            const withinWindow = recent
                ? Date.now() - new Date(recent.createdAt).getTime() < RESEND_WINDOW
                : false
            if (!withinWindow) {
                const token = newToken()
                const tokenHash = hashToken(token)
                await db.collection('password_resets').deleteMany({ userId: user.uid })
                await db.collection('password_resets').insertOne({
                    userId: user.uid,
                    tokenHash,
                    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL),
                    createdAt: new Date()
                })

                const site = getSiteConfig()
                const link = buildLink(request, '/reset-password', token)
                const mail = renderResetMail(mailLang(request), site.name, link)
                try {
                    await sendMail({
                        to: email,
                        subject: mail.subject,
                        text: mail.text,
                        html: mail.html
                    })
                } catch (error) {
                    if (isFormRequest(request)) {
                        request.flash('error', 'flash.mailSendFailed')
                        return reply.redirect('/forgot-password')
                    }
                    return reply.code(502).send({ success: false, error: errorMessage(error) })
                }
            }
        }

        // 邮箱是否存在返回同样的结果，避免被用来枚举账号
        if (isFormRequest(request)) {
            request.flash('success', 'flash.resetMailSent')
            return reply.redirect('/lostpass')
        }
        return reply.send({ success: true })
    })

    const resetBodySchema = Type.Object({
        token: Type.String({ minLength: 16, maxLength: 256 }),
        password: Type.String({ minLength: 1, maxLength: 256 })
    })
    server.post<{ Body: Static<typeof resetBodySchema> }>('/api/v1/password/reset', {
        schema: { body: resetBodySchema }
    }, async (request, reply) => {
        if (!getSMTPConfig()) {
            if (isFormRequest(request)) {
                request.flash('error', 'flash.smtpNotConfigured')
                return reply.redirect('/login')
            }
            return reply.code(503).send({ success: false, error: 'SMTP is not configured' })
        }

        const { token, password } = request.body
        const db = getDB()
        const doc = await db.collection('password_resets').findOne({ tokenHash: hashToken(token) })
        const expiresAt = doc?.expiresAt ? new Date(doc.expiresAt).getTime() : 0
        if (!doc || expiresAt < Date.now()) {
            if (isFormRequest(request)) {
                request.flash('error', 'flash.resetInvalid')
                return reply.redirect('/forgot-password')
            }
            return reply.code(400).send({ success: false, error: 'Invalid or expired reset link' })
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)
        await db.collection('users').updateOne({ uid: doc.userId }, { $set: { password: hashedPassword } })
        await db.collection('password_resets').deleteOne({ tokenHash: doc.tokenHash })

        if (isFormRequest(request)) {
            request.flash('success', 'flash.resetSuccess')
            return reply.redirect('/login')
        }
        return reply.send({ success: true })
    })
}

export function registerAuthPrivs(): void {
    privManager.registerPriv('auth:register', ['guest'])
    privManager.registerPriv('auth:login', ['default', 'superuser'])
}
