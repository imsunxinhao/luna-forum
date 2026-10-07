import { getDB } from '../../src/db.js';
import { ObjectId } from 'mongodb';
import fastifyStatic from '@fastify/static';
import { renderPage, setRequest } from './render.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setLocale, detectLocale, t, getAvailableLocales } from './i18n.js';

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

function applyRequestLocale(request: FastifyRequest): void {
    setLocale(detectLocale(request.headers, (request as FastifyRequest & { cookies?: Record<string, string> }).cookies));
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
        applyRequestLocale(request);
        const html = await renderPage('login.html', {
            pagename: t('page.login'),
            error
        });
        return reply.type('text/html').send(html);
    });
    server.get('/register', async (request: FastifyRequest, reply: FastifyReply) => {
        const error = getFlash(request, 'error');
        applyRequestLocale(request);
        const html = await renderPage('register.html', { pagename: t('page.register'), error });
        return reply.type('text/html').send(html);
    });
    server.get('/post/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        applyRequestLocale(request);
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
            pagename: post.title ?? t('page.postPreview'),
            post_doc: post,
            author,
            comments
        });
        return reply.type('text/html').send(html);
    });
    server.get('/user/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const { page = 1, limit = 20 } = request.query as { page?: string; limit?: string };
        applyRequestLocale(request);
        const db = getDB();
        const uid = Number(id);
        if (!Number.isInteger(uid) || uid < 0) {
            return reply.code(400).send({ success: false, error: 'Invalid user id' });
        }
        const user_doc = await db.collection('users').findOne(
            { uid },
            { projection: { password: 0, twofaSecret: 0, _id: 0 } }
        );
        if (!user_doc) {
            return reply.code(404).send({ success: false, error: 'User not found' });
        }
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
        const skip = (pageNum - 1) * limitNum;
        const postFilter = { authorId: uid };
        const posts = await db.collection('posts')
            .find(postFilter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .toArray();
        const total = await db.collection('posts').countDocuments(postFilter);
        const html = await renderPage('user_home.html', {
            pagename: user_doc.username ?? t('page.userProfile'),
            user_doc,
            posts,
            total,
            page: pageNum,
            limit: limitNum
        });
        return reply.type('text/html').send(html);
    });
    server.get('/api/v1/locale/:locale', async (request: FastifyRequest, reply: FastifyReply) => {
        const { locale } = request.params as { locale: string };
        const { redirect } = request.query as { redirect?: string };
        const available = getAvailableLocales().map(l => l.code);
        if (!available.includes(locale)) {
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
            if (redirect.startsWith('/') && !redirect.startsWith('//')) {
                return reply.redirect(redirect);
            }
            return reply.redirect('/');
        }
        return { success: true, locale };
    });
}