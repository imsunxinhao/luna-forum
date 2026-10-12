import { createTransport, type Transporter } from 'nodemailer'
import { Type, type Static } from '@sinclair/typebox'
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify'
import { getDB } from './db.js'
import { getSMTPConfig, setSMTPConfig, type SMTPConfig } from './config.js'
import { privManager } from './privmgr.js'
import { hookManager } from './hookmgr.js'
import type { MailMessage, MailStatus } from './types.js'

const POOL_MAX_CONNECTIONS = 3
const POOL_MAX_MESSAGES = 100

const MAIL_ADMIN_PRIV = 'mail:admin'
const MAIL_SEND_PRIV = 'mail:send'

let logger: FastifyBaseLogger | null = null
let transporter: Transporter | null = null
let transportSignature = ''

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        let msg = error.message
        const e = error as { code?: string; syscall?: string; errno?: unknown; responseCode?: unknown; command?: string; response?: string }
        if (e.code) msg += ` (code: ${e.code})`
        if (e.syscall) msg += ` syscall=${e.syscall}`
        if (e.errno !== undefined) msg += ` errno=${e.errno}`
        if (e.responseCode !== undefined) msg += ` responseCode=${e.responseCode}`
        if (e.command) msg += ` command=${e.command}`
        if (e.response) msg += ` response=${e.response}`
        if (error.cause) msg += ` cause=${errorMessage(error.cause)}`
        return msg
    }
    return String(error)
}

/**
 * Translate nodemailer / network errors into a readable failure reason,
 * so it is easy to tell why SMTP is not working.
 */
function describeMailError(error: unknown): string {
    const code = (error as { code?: string })?.code
    const detail = errorMessage(error)
    // nodemailer reports DNS failures as EDNS, but the message still contains ENOTFOUND / getaddrinfo
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS' || /ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(detail)) {
        return `SMTP host name could not be resolved: check that "host" is spelled correctly and that DNS is reachable. (${detail})`
    }
    // verify()/sendMail() may wrap ECONNREFUSED as ESOCKET, but the message still contains ECONNREFUSED
    if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(detail)) {
        return `Could not connect to the SMTP server: connection refused. Check that host/port are correct, the server is running, and the firewall allows the connection. (${detail})`
    }
    switch (code) {
        case 'ETIMEDOUT':
        case 'ECONNRESET':
            return `The connection to the SMTP server timed out or was reset: check network connectivity, the firewall, and that the port uses the correct encryption mode. (${detail})`
        case 'EAUTH':
            return `SMTP authentication failed: check the username/password. Some providers (e.g. Gmail) require an "app-specific password" rather than the login password, and SMTP access may need to be enabled. (${detail})`
        case 'ESOCKET':
            return `Socket communication with the SMTP server failed: usually a network or TLS configuration issue. (${detail})`
        case 'ETLS':
            return `TLS handshake failed: the port's encryption mode does not match the configuration (465 should be secure/SSL; 587/25 should be STARTTLS). (${detail})`
        case 'EENVELOPE':
            if (/mail from account doesn't conform|doesn't conform with authentication/i.test(detail)) {
                return `The SMTP server rejected the message: the sender address (MAIL FROM) does not match the authenticated account. Set "from" to the mailbox used to log in (or leave it empty so the authenticated account is used as the sender). (${detail})`
            }
            return detail
        default:
            return detail
    }
}

function signatureOf(cfg: SMTPConfig): string {
    return JSON.stringify(cfg)
}

function buildTransporter(cfg: SMTPConfig): Transporter {
    return createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
        pool: true,
        maxConnections: POOL_MAX_CONNECTIONS,
        maxMessages: POOL_MAX_MESSAGES
    })
}

function closeTransporter(): void {
    if (transporter) {
        try {
            transporter.close()
        } catch {
            logger?.error('SMTP: failed to close transporter')
        }
    }
    transporter = null
    transportSignature = ''
}

/**
 * Get (or rebuild) the SMTP connection pool based on the current config.
 * When the config signature changes the pool is rebuilt, so changes made to
 * the smtp.* settings in the database take effect on the next send automatically.
 */
function getTransporter(): Transporter {
    const cfg = getSMTPConfig()
    if (!cfg) throw new Error('SMTP is not configured')
    const signature = signatureOf(cfg)
    if (!transporter || signature !== transportSignature) {
        closeTransporter()
        transporter = buildTransporter(cfg)
        transportSignature = signature
    }
    return transporter
}

export function registerMailPrivs(): void {
    privManager.registerPriv(MAIL_SEND_PRIV, ['superuser'])
    privManager.registerPriv(MAIL_ADMIN_PRIV, ['superuser'])
}

/**
 * Called when the kernel boots: warm up the connection pool from config and
 * print its status (no network connection is made yet).
 */
export function initMail(log?: FastifyBaseLogger): void {
    if (log) logger = log
    const cfg = getSMTPConfig()
    if (!cfg) {
        logger?.info('SMTP: not configured, sending mail is disabled')
        return
    }
    try {
        getTransporter()
        logger?.info(`SMTP: ${cfg.host}:${cfg.port}${cfg.user ? ' (authenticated)' : ''} connection pool ready`)
    } catch (error) {
        logger?.error(`SMTP: failed to initialize connection pool: ${describeMailError(error)}`)
    }
}

/**
 * Called when the kernel stops: release the connection pool.
 */
export function closeMail(): void {
    closeTransporter()
    logger = null
}

export function isMailConfigured(): boolean {
    return getSMTPConfig() !== null
}

export function getMailStatus(): MailStatus {
    const cfg = getSMTPConfig()
    if (!cfg) {
        return { configured: false, host: '', port: 0, user: '', from: '', secure: false, hasPass: false }
    }
    return {
        configured: true,
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        from: cfg.from,
        secure: cfg.port === 465,
        hasPass: Boolean(cfg.pass)
    }
}

export async function updateMailConfig(patch: Partial<SMTPConfig>): Promise<void> {
    await setSMTPConfig(patch)
    closeTransporter()
}

export async function verifyMail(): Promise<void> {
    try {
        await getTransporter().verify()
        logger?.info('SMTP: server connection verified')
    } catch (error) {
        const message = describeMailError(error)
        logger?.error(`SMTP: server connection verification failed: ${message}`)
        throw new Error(message)
    }
}

/**
 * Send a mail message. Triggers the mail:beforeSend / mail:afterSend hooks;
 * an object returned by a before-hook is merged into the mail payload.
 */
export async function sendMail(message: MailMessage): Promise<string> {
    const cfg = getSMTPConfig()
    if (!cfg) throw new Error('SMTP is not configured')

    const payload: MailMessage = { ...message }
    if (!payload.to) throw new Error('Mail message needs a recipient')
    if (!payload.subject) throw new Error('Mail message needs a subject')
    if (!payload.text && !payload.html) throw new Error('Mail message needs text or html')

    const beforeResults = await hookManager.call('mail:beforeSend', payload)
    for (const result of beforeResults) {
        if (result && typeof result === 'object') Object.assign(payload, result)
    }

    let info
    try {
        // The display From: header is what recipients see (configured "from", falling
        // back to the authenticated account). The envelope sender (MAIL FROM) is forced
        // to the authenticated account, because many SMTP providers reject the message
        // when MAIL FROM does not match the logged-in account (e.g. error 440).
        const fromHeader = payload.from || cfg.from || cfg.user || undefined
        const recipients: string[] = []
        for (const field of [payload.to, payload.cc, payload.bcc]) {
            if (field === undefined) continue
            if (Array.isArray(field)) recipients.push(...field)
            else recipients.push(field)
        }
        const envelope = cfg.user ? { from: cfg.user, to: recipients } : undefined
        info = await getTransporter().sendMail({
            from: fromHeader,
            to: payload.to,
            cc: payload.cc,
            bcc: payload.bcc,
            replyTo: payload.replyTo,
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
            headers: payload.headers,
            envelope
        })
    } catch (error) {
        const message = describeMailError(error)
        logger?.error(`SMTP: failed to send "${payload.subject}" -> ${String(payload.to)}: ${message}`)
        throw new Error(message)
    }

    await hookManager.call('mail:afterSend', info, payload)

    const messageId = String(info.messageId ?? '')
    logger?.info(`SMTP: sent "${payload.subject}" to ${String(payload.to)} (messageId=${messageId})`)
    return messageId
}

/**
 * Register SMTP management routes. The function that resolves the current user
 * is injected by the kernel, so that mail.ts does not depend back on auth.ts.
 */
export function setupMailRoutes(server: FastifyInstance, resolveUserId: (request: FastifyRequest) => number): void {
    if (!logger) logger = server.log

    const isMailAdmin = async (request: FastifyRequest): Promise<boolean> =>
        privManager.hasPriv(resolveUserId(request), MAIL_ADMIN_PRIV)

    const findSelfEmail = async (request: FastifyRequest): Promise<string> => {
        const userId = resolveUserId(request)
        if (!userId) return ''
        const user = await getDB()
            .collection('users')
            .findOne({ uid: userId }, { projection: { email: 1 } })
        return typeof user?.email === 'string' ? user.email : ''
    }

    const statusSchema = Type.Object({
        configured: Type.Boolean(),
        host: Type.String(),
        port: Type.Number(),
        user: Type.String(),
        from: Type.String(),
        secure: Type.Boolean(),
        hasPass: Type.Boolean()
    })
    const okSchema = Type.Object({
        success: Type.Boolean(),
        messageId: Type.Optional(Type.String())
    })
    const errorSchema = Type.Object({
        success: Type.Boolean(),
        error: Type.String()
    })

    type StatusReply = Static<typeof statusSchema>
    type OkReply = Static<typeof okSchema>
    type ErrorReply = Static<typeof errorSchema>

    server.get<{ Reply: StatusReply | ErrorReply }>('/api/v1/mail/status', {
        schema: {
            response: {
                200: statusSchema,
                403: errorSchema
            }
        }
    }, async (request, reply) => {
        if (!(await isMailAdmin(request))) {
            return reply.code(403).send({ success: false, error: 'No permission to manage SMTP' })
        }
        return getMailStatus()
    })

    const configBodySchema = Type.Object({
        host: Type.Optional(Type.String({ maxLength: 255 })),
        port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
        user: Type.Optional(Type.String({ maxLength: 255 })),
        pass: Type.Optional(Type.String({ maxLength: 512 })),
        from: Type.Optional(Type.String({ maxLength: 320 }))
    })
    server.put<{ Body: Static<typeof configBodySchema>, Reply: StatusReply | ErrorReply }>('/api/v1/mail/config', {
        schema: {
            body: configBodySchema,
            response: {
                200: statusSchema,
                403: errorSchema
            }
        }
    }, async (request, reply) => {
        if (!(await isMailAdmin(request))) {
            return reply.code(403).send({ success: false, error: 'No permission to manage SMTP' })
        }
        const body = request.body
        const patch: Partial<SMTPConfig> = {}
        if (body.host !== undefined) patch.host = body.host.trim()
        if (body.port !== undefined) patch.port = body.port
        if (body.user !== undefined) patch.user = body.user.trim()
        if (body.pass !== undefined) patch.pass = body.pass
        if (body.from !== undefined) patch.from = body.from.trim()
        await updateMailConfig(patch)
        return getMailStatus()
    })

    const testBodySchema = Type.Object({
        to: Type.Optional(Type.String({ maxLength: 320 }))
    })
    server.post<{ Body: Static<typeof testBodySchema>, Reply: OkReply | ErrorReply }>('/api/v1/mail/test', {
        schema: {
            body: testBodySchema,
            response: {
                200: okSchema,
                403: errorSchema,
                503: errorSchema,
                502: errorSchema
            }
        }
    }, async (request, reply) => {
        if (!(await isMailAdmin(request))) {
            return reply.code(403).send({ success: false, error: 'No permission to test SMTP' })
        }
        if (!isMailConfigured()) {
            return reply.code(503).send({ success: false, error: 'SMTP is not configured' })
        }
        const to = request.body.to?.trim() || await findSelfEmail(request)
        if (!to) {
            return reply.code(400).send({
                success: false,
                error: 'No recipient: pass "to", or set an email address on your account'
            })
        }
        try {
            await verifyMail()
            const messageId = await sendMail({
                to,
                subject: 'Luna Forum SMTP test mail',
                text: [
                    'This is a test mail sent by Luna Forum.',
                    '',
                    `Time: ${new Date().toISOString()}`,
                    `Host: ${getMailStatus().host}:${getMailStatus().port}`
                ].join('\n')
            })
            return reply.code(200).send({ success: true, messageId })
        } catch (error) {
            const message = describeMailError(error)
            logger?.error(`SMTP test failed: ${message}`)
            return reply.code(502).send({ success: false, error: message })
        }
    })

    const sendBodySchema = Type.Object({
        to: Type.Union([
            Type.String({ maxLength: 320 }),
            Type.Array(Type.String({ maxLength: 320 }), { maxItems: 50 })
        ]),
        subject: Type.String({ minLength: 1, maxLength: 200 }),
        text: Type.Optional(Type.String({ maxLength: 100000 })),
        html: Type.Optional(Type.String({ maxLength: 200000 })),
        cc: Type.Optional(Type.Array(Type.String({ maxLength: 320 }), { maxItems: 50 })),
        bcc: Type.Optional(Type.Array(Type.String({ maxLength: 320 }), { maxItems: 50 })),
        replyTo: Type.Optional(Type.String({ maxLength: 320 }))
    })
    server.post<{ Body: Static<typeof sendBodySchema>, Reply: OkReply | ErrorReply }>('/api/v1/mail/send', {
        schema: {
            body: sendBodySchema,
            response: {
                200: okSchema,
                403: errorSchema,
                503: errorSchema,
                502: errorSchema
            }
        }
    }, async (request, reply) => {
        const userId = resolveUserId(request)
        if (!(await privManager.hasPriv(userId, MAIL_SEND_PRIV))) {
            return reply.code(403).send({ success: false, error: 'No permission to send mail' })
        }
        if (!isMailConfigured()) {
            return reply.code(503).send({ success: false, error: 'SMTP is not configured' })
        }
        const body = request.body
        if (!body.text && !body.html) {
            return reply.code(400).send({ success: false, error: 'text or html is required' })
        }
        try {
            const messageId = await sendMail({
                to: body.to,
                subject: body.subject,
                text: body.text,
                html: body.html,
                cc: body.cc,
                bcc: body.bcc,
                replyTo: body.replyTo
            })
            return reply.code(200).send({ success: true, messageId })
        } catch (error) {
            const message = describeMailError(error)
            logger?.error(`SMTP send failed: ${message}`)
            return reply.code(502).send({ success: false, error: message })
        }
    })
}
