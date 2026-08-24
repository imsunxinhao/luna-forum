// import { renderTemplate } from './render.js';
// import { getDB } from '../../src/db.js';
// import { ObjectId } from 'mongodb';
import fastifyStatic from '@fastify/static';
import { renderPage, setRequest } from './render.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../../src/db.js';
import { getUserIdFromRequest } from '../../src/auth.js';
import type { KernelAPI } from '../../src/types.js';

function getFlash(request: FastifyRequest, key: string): string | null {
    const req = request as FastifyRequest & { session?: { get: (k: string) => unknown; set: (k: string, v: unknown) => void } };
    const flashData = req.session?.get('flash') as Record<string, string[]> | undefined;
    const value = flashData?.[key]?.[0] ?? null;
    if (flashData && req.session) {
        const remaining = { ...flashData };
        delete remaining[key];
        req.session.set('flash', remaining);
    }
    return value;
}

export function setupFrontendRoutes(server: FastifyInstance, kernel: KernelAPI): void {
    server.addHook('onRequest', async (request: FastifyRequest) => {
        setRequest(request);
    });
    server.register(fastifyStatic, {
        root: resolve(dirname(fileURLToPath(import.meta.url)), 'public'),
        prefix: '/static/'
    });
    server.get('/login', async (request: FastifyRequest, reply: FastifyReply) => {
        const error = getFlash(request, 'error');
        const html = await renderPage('login.html', {
            pagename: '登录',
            error
        });
        return reply.type('text/html').send(html);
    });
    server.get('/register', async (request: FastifyRequest, reply: FastifyReply) => {
        const error = getFlash(request, 'error');
        const html = await renderPage('register.html', { pagename: '注册', error });
        return reply.type('text/html').send(html);
    });
    server.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDB();
        const userId = getUserIdFromRequest(request);

        const [tags, tagCount, userCount] = await Promise.all([
            db.collection('tags').find().sort({ sortOrder: 1 }).toArray(),
            db.collection('tags').countDocuments({}),
            db.collection('users').countDocuments({ uid: { $gt: 0 } })
        ]);

        const enrichedTags = tags.map((tag) => ({
            ...tag,
            id: String(tag._id),
            postCount: typeof tag.postCount === 'number' ? tag.postCount : 0
        }));

        // 聚合各插件（如 post）为首页贡献的数据
        const hookResults = await kernel.callHook('home:getData', { userId });
        const pluginData: Record<string, unknown> = {};
        for (const result of hookResults) {
            if (result && typeof result === 'object') {
                Object.assign(pluginData, result as Record<string, unknown>);
            }
        }

        const postCount = typeof pluginData.postCount === 'number' ? pluginData.postCount : 0;

        const html = await renderPage('index.html', {
            pagename: '首页',
            tags: enrichedTags,
            stats: { postCount, tagCount, userCount },
            ...pluginData
        });
        return reply.type('text/html').send(html);
    });
}