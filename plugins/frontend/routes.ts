import { getDB } from '../../src/db.js';
import { ObjectId } from 'mongodb';
import fastifyStatic from '@fastify/static';
import { renderPage, setRequest } from './render.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setLocale } from './i18n.js';

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

export function setupFrontendRoutes(server: FastifyInstance): void {
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
    server.get('/post/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const db = getDB();
        const post = await db.collection('posts').findOne({ _id: new ObjectId(id) });
        if (!post) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const author = await db.collection('users').findOne(
            { uid: post.authorId },
            { projection: { password: 0, twofaSecret: 0, _id: 0 } }
        );
        const commentsRaw = await db.collection('comments')
            .find({ postId: id })
            .sort({ createdAt: -1 })
            .toArray();
        const comments = await Promise.all(
            commentsRaw.map(async (comment) => {
                const commentAuthor = await db.collection('users').findOne(
                    { uid: comment.authorId },
                    { projection: { password: 0, twofaSecret: 0, _id: 0 } }
                );
                return { ...comment, author: commentAuthor };
            })
        );
        const html = await renderPage('post/post_view.html', {
            pagename: post.title ?? '帖子预览',
            post_doc: post,
            author,
            comments
        });
        return reply.type('text/html').send(html);
    });
    server.get('/api/v1/locale/:locale', async (request: FastifyRequest, reply: FastifyReply) => {
        const { locale } = request.params as { locale: string };
        const { redirect } = request.query as { redirect?: string };
        if (!['zh-cn', 'en'].includes(locale)) {
            return reply.code(400).send({ success: false, error: 'Invalid locale' });
        }
        setLocale(locale);
        reply.setCookie('locale', locale, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 365 * 24 * 60 * 60
        });
        if (redirect) {
            return reply.redirect(redirect);
        }
        return { success: true, locale };
    });
}