import { resolve, dirname, extname, sep } from 'path'
import { createRequire } from 'module'
import { readFile } from 'fs/promises'
import type { Plugin } from '../../src/types.js'
import { setupPostRoutes } from './routes.js'
import { getHomePosts } from './home.js'

const KATEX_MIME: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf'
}

const MONACO_MIME: Record<string, string> = {
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2'
}

const POST_MAGIC = 2
const PRIV_POST_CREATE = POST_MAGIC + 0
const PRIV_POST_EDIT = POST_MAGIC + 1
const PRIV_POST_DELETE = POST_MAGIC + 2
const PRIV_POST_VIEW = POST_MAGIC + 3
const PRIV_VIEW_ALL_POST = POST_MAGIC + 4

const postPlugin: Plugin = {
    name: 'post',
    version: '0.1.0',
    deps: ['frontend'],

    async init(ctx) {
        ctx.registerPriv('PRIV_POST_CREATE', String(PRIV_POST_CREATE), true)
        ctx.registerPriv('PRIV_POST_EDIT', String(PRIV_POST_EDIT))
        ctx.registerPriv('PRIV_POST_DELETE', String(PRIV_POST_DELETE), true)
        ctx.registerPriv('PRIV_POST_VIEW', String(PRIV_POST_VIEW), true)
        ctx.registerPriv('PRIV_VIEW_ALL_POST', String(PRIV_VIEW_ALL_POST))

        const db = ctx.kernel.getDB()

        const guest = await db
            .collection('users')
            .findOne({ uid: 0 })
        const guestPriv = BigInt(guest ? String(guest.priv) : '0')

        const viewPriv = guestPriv | (1n << BigInt(PRIV_POST_VIEW))

        await db
            .collection('users')
            .updateOne({ uid: 0 }, { $set: { priv: viewPriv.toString() } })

        await ctx.kernel.executeCommand('template:addPath', resolve(import.meta.dirname, 'templates'))

        await ctx.registerHook('home:getData', async (...args: unknown[]) => {
            const payload = (args[0] ?? {}) as { userId?: number }
            const userId = payload.userId ?? 0
            return getHomePosts(ctx.kernel, userId)
        })

        const server = ctx.kernel.getServer()

        // 提供 KaTeX 的 CSS 与字体文件，供帖子预览页渲染数学公式
        const require = createRequire(import.meta.url)
        const katexDistDir = dirname(require.resolve('katex/dist/katex.min.css'))
        server.get('/static/katex/*', async (request, reply) => {
            const file = (request.params as { '*': string })['*'] ?? ''
            const fullPath = resolve(katexDistDir, file)
            if (!fullPath.startsWith(katexDistDir + sep)) {
                return reply.code(404).send()
            }
            try {
                const data = await readFile(fullPath)
                const mime = KATEX_MIME[extname(fullPath).toLowerCase()] ?? 'application/octet-stream'
                return reply.type(mime).send(data)
            } catch {
                return reply.code(404).send()
            }
        })

        // 提供 marked 的浏览器构建，供发帖页 Markdown 实时预览使用
        server.get('/static/marked.js', async (request, reply) => {
            try {
                const markedPkgJson = require.resolve('marked/package.json')
                const markedUmd = resolve(dirname(markedPkgJson), 'lib/marked.umd.js')
                const data = await readFile(markedUmd)
                return reply.type('application/javascript; charset=utf-8').send(data)
            } catch {
                return reply.code(404).send()
            }
        })

        // 提供 twemoji 的浏览器构建，用于表情渲染
        server.get('/static/twemoji/twemoji.min.js', async (request, reply) => {
            try {
                const twemojiMain = require.resolve('twemoji')
                const twemojiMin = resolve(dirname(twemojiMain), 'twemoji.min.js')
                const data = await readFile(twemojiMin)
                return reply.type('application/javascript; charset=utf-8').send(data)
            } catch {
                return reply.code(404).send()
            }
        })

        // 提供 twemoji 表情图片资源（本地，来自 emoji-datasource-twitter）
        const twemojiAssetsDir = resolve(dirname(require.resolve('emoji-datasource-twitter/package.json')), 'img', 'twitter')
        server.get('/static/twemoji/*', async (request, reply) => {
            const file = (request.params as { '*': string })['*'] ?? ''
            const fullPath = resolve(twemojiAssetsDir, file)
            if (!fullPath.startsWith(twemojiAssetsDir + sep)) {
                return reply.code(404).send()
            }
            try {
                const data = await readFile(fullPath)
                const ext = extname(fullPath).toLowerCase()
                const mime = ext === '.svg' ? 'image/svg+xml'
                    : ext === '.png' ? 'image/png'
                    : 'application/octet-stream'
                return reply.type(mime).send(data)
            } catch {
                return reply.code(404).send()
            }
        })

        // 提供 Monaco Editor 的构建文件，供发帖页编辑器使用
        const monacoVsDir = dirname(require.resolve('monaco-editor'))
        server.get('/static/monaco/vs/*', async (request, reply) => {
            const file = (request.params as { '*': string })['*'] ?? ''
            const fullPath = resolve(monacoVsDir, file)
            if (!fullPath.startsWith(monacoVsDir + sep)) {
                return reply.code(404).send()
            }
            try {
                const data = await readFile(fullPath)
                const mime = MONACO_MIME[extname(fullPath).toLowerCase()] ?? 'application/octet-stream'
                return reply.type(mime).send(data)
            } catch {
                return reply.code(404).send()
            }
        })

        setupPostRoutes(server, ctx.kernel)
    },

    async activate() { },
    async deactivate() { }
}
export default postPlugin