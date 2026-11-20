import { getDB } from '../../src/db.js';
import { ObjectId } from 'mongodb';
import fastifyStatic from '@fastify/static';
import { renderPage, setRequest } from './render.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setLocale, detectLocale, t, getAvailableLocales } from './i18n.js';
import { isMailConfigured } from '../../src/mail.js';
import { getUserIdFromRequest } from '../../src/auth.js';
import { privManager } from '../../src/privmgr.js';
import { buildVisibilityFilter, canViewPost } from '../post/access.js';
import { buildCommentTree } from '../post/comments.js';

const FEED_PAGE_SIZE = 10;
const COMMENT_PAGE_SIZE = 50;

interface PostAuthor {
    uid: number;
    username: string;
    avatar?: string;
}

interface TagSummary {
    id: string;
    name: string;
    postCount: number;
}

interface DecoratedPost extends Record<string, unknown> {
    id: string;
    title: string;
    excerpt: string;
    createdAt: string;
    author: PostAuthor | null;
    commentCount: number;
    tag: { id: string; name: string } | null;
    pinned: boolean;
}

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

function toObjectId(value: string): ObjectId | null {
    return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function iso(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString();
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** 从正文生成纯文本摘要，用于列表/卡片。 */
function stripMarkdown(markdown: string, max = 180): string {
    const text = markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/[*_~]{1,3}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > max ? text.slice(0, max) + '…' : text;
}

function asVisibility(post: Record<string, unknown> | null): { authorId?: number; visibility?: number } | null {
    if (!post) return null;
    return {
        authorId: typeof post.authorId === 'number' ? post.authorId : undefined,
        visibility: post.visibility === null
            ? undefined
            : (typeof post.visibility === 'number' ? post.visibility : undefined)
    };
}

async function loadAuthors(db: ReturnType<typeof getDB>, ids: number[]): Promise<Map<number, PostAuthor>> {
    const unique = [...new Set(ids)];
    const result = new Map<number, PostAuthor>();
    if (unique.length === 0) return result;
    const users = await db.collection('users').find(
        { uid: { $in: unique } },
        { projection: { uid: 1, username: 1, avatar: 1, _id: 0 } }
    ).toArray();
    for (const user of users) {
        const uid = Number(user.uid);
        result.set(uid, {
            uid,
            username: String(user.username ?? ''),
            avatar: typeof user.avatar === 'string' ? user.avatar : undefined
        });
    }
    return result;
}

async function loadCommentCounts(db: ReturnType<typeof getDB>, postIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (postIds.length === 0) return result;
    const rows = await db.collection('comments').aggregate([
        { $match: { postId: { $in: postIds }, deleted: { $ne: true } } },
        { $group: { _id: '$postId', count: { $sum: 1 } } }
    ]).toArray();
    for (const row of rows) {
        result.set(String(row._id), Number(row.count));
    }
    return result;
}

async function loadTags(db: ReturnType<typeof getDB>, postFilter: Record<string, unknown>, fallbackGlobal = false): Promise<TagSummary[]> {
    const counts = await db.collection('posts').aggregate([
        { $match: { ...postFilter, tagId: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$tagId', count: { $sum: 1 } } }
    ]).toArray();
    const countMap = new Map(counts.map(row => [String(row._id), Number(row.count)]));
    const tags = await db.collection('tags').find().sort({ sortOrder: 1, name: 1 }).toArray();
    return tags.map(tag => {
        const id = tag._id.toString();
        return {
            id,
            name: String(tag.name ?? ''),
            postCount: countMap.get(id) ?? (fallbackGlobal ? Number(tag.postCount ?? 0) : 0)
        };
    });
}

async function decoratePosts(db: ReturnType<typeof getDB>, posts: Record<string, unknown>[]): Promise<DecoratedPost[]> {
    const postIds = posts.map(post => String(post._id));
    const authorIds = posts
        .map(post => Number(post.authorId))
        .filter(id => Number.isFinite(id));
    const [authors, commentCounts, tags] = await Promise.all([
        loadAuthors(db, authorIds),
        loadCommentCounts(db, postIds),
        db.collection('tags').find().toArray()
    ]);
    const tagMap = new Map(tags.map(tag => [tag._id.toString(), String(tag.name ?? '')]));
    return posts.map(post => {
        const id = String(post._id);
        const tagId = typeof post.tagId === 'string' ? post.tagId : '';
        return {
            ...post,
            id,
            title: String(post.title ?? ''),
            excerpt: stripMarkdown(String(post.content ?? '')),
            createdAt: iso(post.createdAt),
            author: authors.get(Number(post.authorId)) ?? null,
            commentCount: commentCounts.get(id) ?? Number(post.commentCount ?? 0),
            tag: tagId && tagMap.has(tagId) ? { id: tagId, name: tagMap.get(tagId) ?? '' } : null,
            pinned: post.pinned === true
        };
    });
}

async function getPostPermissions(userId: number, post: Record<string, unknown>) {
    const isOwner = post.authorId === userId;
    const [canEditOwn, canDeleteOwn, canEditAll, canDeleteAll, canComment, canCommentEditOwn, canCommentDeleteOwn, canCommentEditAll, canCommentDeleteAll] = await Promise.all([
        privManager.hasPriv(userId, 'post:edit_own'),
        privManager.hasPriv(userId, 'post:delete_own'),
        privManager.hasPriv(userId, 'post:edit_all'),
        privManager.hasPriv(userId, 'post:delete_all'),
        privManager.hasPriv(userId, 'post:comment_create'),
        privManager.hasPriv(userId, 'post:comment_edit_own'),
        privManager.hasPriv(userId, 'post:comment_delete_own'),
        privManager.hasPriv(userId, 'post:comment_edit_all'),
        privManager.hasPriv(userId, 'post:comment_delete_all')
    ]);
    return {
        canEditPost: isOwner ? canEditOwn : canEditAll,
        canDeletePost: isOwner ? canDeleteOwn : canDeleteAll,
        canComment: userId > 0 && canComment,
        canCommentEditOwn,
        canCommentDeleteOwn,
        canCommentEditAll,
        canCommentDeleteAll
    };
}

async function renderNotFound(reply: FastifyReply, message: string): Promise<FastifyReply> {
    return reply.code(404).type('text/html').send(
        `<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8"><title>${message}</title></head><body><h1>${message}</h1><p><a href="/">返回首页</a></p></body></html>`
    );
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
        const success = getFlash(request, 'success');
        applyRequestLocale(request);
        const html = await renderPage('login.html', {
            pagename: t('page.login'),
            error,
            success,
            smtpEnabled: isMailConfigured()
        });
        return reply.type('text/html').send(html);
    });
    server.get('/register', async (request: FastifyRequest, reply: FastifyReply) => {
        const error = getFlash(request, 'error');
        const success = getFlash(request, 'success');
        applyRequestLocale(request);
        const html = await renderPage('register.html', {
            pagename: t('page.register'),
            error,
            success
        });
        return reply.type('text/html').send(html);
    });
    server.get('/lostpass', async (request: FastifyRequest, reply: FastifyReply) => {
        applyRequestLocale(request);
        if (!isMailConfigured()) { request.flash('error', 'flash.forgotPasswordDisabled'); return reply.redirect('/login'); }
        const html = await renderPage('forgot_password.html', {
            pagename: t('page.forgotPassword'),
            error: getFlash(request, 'error'),
            success: getFlash(request, 'success')
        });
        return reply.type('text/html').send(html);
    });
    server.get('/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
        applyRequestLocale(request);
        if (!isMailConfigured()) return reply.redirect('/login');
        const { token } = request.query as { token?: string };
        if (!token) return reply.redirect('/forgot-password');
        const html = await renderPage('reset_password.html', {
            pagename: t('page.resetPassword'),
            token,
            error: getFlash(request, 'error'),
            success: getFlash(request, 'success')
        });
        return reply.type('text/html').send(html);
    });

    // ------------------------------------------------------------------
    // 社区首页：帖子流 + 标签
    // ------------------------------------------------------------------
    server.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
        applyRequestLocale(request);
        const db = getDB();
        const userId = getUserIdFromRequest(request);
        const query = request.query as { page?: string; tagId?: string };
        let page = Math.max(1, Number(query.page) || 1);
        const tagId = typeof query.tagId === 'string' && ObjectId.isValid(query.tagId) ? query.tagId : undefined;

        const canViewAll = await privManager.hasPriv(userId, 'post:view_all');
        const visibilityFilter = buildVisibilityFilter(userId, canViewAll);
        const postFilter: Record<string, unknown> = { ...visibilityFilter };
        if (tagId) postFilter.tagId = tagId;

        const [total, tags, canCreatePost] = await Promise.all([
            db.collection('posts').countDocuments(postFilter),
            loadTags(db, visibilityFilter),
            userId > 0 ? privManager.hasPriv(userId, 'post:create') : Promise.resolve(false)
        ]);
        const totalPages = Math.max(1, Math.ceil(total / FEED_PAGE_SIZE));
        if (page > totalPages) page = totalPages;
        const rawPosts = await db.collection('posts')
            .find(postFilter)
            .sort({ pinned: -1, pinnedAt: -1, createdAt: -1 })
            .skip((page - 1) * FEED_PAGE_SIZE)
            .limit(FEED_PAGE_SIZE)
            .toArray();
        const posts = await decoratePosts(db, rawPosts as Record<string, unknown>[]);
        const activeTag = tagId ? tags.find(tag => tag.id === tagId) ?? null : null;
        const sidebarTags = tags.filter(tag => tag.postCount > 0);

        const html = await renderPage('index.html', {
            pagename: activeTag?.name ?? t('page.home'),
            posts,
            total,
            page,
            totalPages,
            tagId: tagId ?? '',
            activeTag,
            tags: sidebarTags,
            canCreatePost
        });
        return reply.type('text/html').send(html);
    });

    // ------------------------------------------------------------------
    // 发帖 / 编辑帖子（必须早于 /post/:id 的语义，Fastify 静态段优先）
    // ------------------------------------------------------------------
    server.get('/post/new', async (request: FastifyRequest, reply: FastifyReply) => {
        applyRequestLocale(request);
        const userId = getUserIdFromRequest(request);
        if (!userId) return reply.redirect('/login');
        if (!(await privManager.hasPriv(userId, 'post:create'))) {
            return reply.code(403).type('text/html').send('<h1>没有发帖权限</h1>');
        }
        const db = getDB();
        const [tagDocs, canHide] = await Promise.all([
            db.collection('tags').find().sort({ sortOrder: 1, name: 1 }).toArray(),
            privManager.hasPriv(userId, 'post:view_all')
        ]);
        const tags = tagDocs.map(tag => ({ id: tag._id.toString(), name: String(tag.name ?? '') }));
        const html = await renderPage('post/post_edit.html', {
            pagename: t('post.newPost'),
            mode: 'create',
            post_doc: null,
            tags,
            canHide
        });
        return reply.type('text/html').send(html);
    });

    server.get('/post/:id/edit', async (request: FastifyRequest, reply: FastifyReply) => {
        applyRequestLocale(request);
        const userId = getUserIdFromRequest(request);
        if (!userId) return reply.redirect('/login');
        const { id } = request.params as { id: string };
        const oid = toObjectId(id);
        if (!oid) return renderNotFound(reply, '帖子不存在');
        const db = getDB();
        const post = await db.collection('posts').findOne({ _id: oid }) as Record<string, unknown> | null;
        if (!post) return renderNotFound(reply, '帖子不存在');
        const isOwner = post.authorId === userId;
        const canEdit = isOwner
            ? await privManager.hasPriv(userId, 'post:edit_own')
            : await privManager.hasPriv(userId, 'post:edit_all');
        if (!canEdit) {
            return reply.code(403).type('text/html').send('<h1>没有编辑这篇帖子的权限</h1>');
        }
        const [tagDocs, canHide] = await Promise.all([
            db.collection('tags').find().sort({ sortOrder: 1, name: 1 }).toArray(),
            privManager.hasPriv(userId, 'post:view_all')
        ]);
        const tags = tagDocs.map(tag => ({ id: tag._id.toString(), name: String(tag.name ?? '') }));
        const html = await renderPage('post/post_edit.html', {
            pagename: t('post.editPost'),
            mode: 'edit',
            post_id: id,
            post_doc: { ...post, createdAt: iso(post.createdAt), updatedAt: iso(post.updatedAt) },
            tags,
            canHide
        });
        return reply.type('text/html').send(html);
    });

    // ------------------------------------------------------------------
    // 帖子详情 + 评论区
    // ------------------------------------------------------------------
    server.get('/post/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        applyRequestLocale(request);
        const oid = toObjectId(id);
        if (!oid) return renderNotFound(reply, '帖子不存在');
        const db = getDB();
        const userId = getUserIdFromRequest(request);
        const canViewAll = await privManager.hasPriv(userId, 'post:view_all');
        const post = await db.collection('posts').findOne({ _id: oid }) as Record<string, unknown> | null;
        if (!post) return renderNotFound(reply, '帖子不存在');
        if (!canViewPost(asVisibility(post), userId, canViewAll)) {
            return reply.code(403).type('text/html').send('<h1>没有查看这篇帖子的权限</h1>');
        }

        const query = request.query as { page?: string };
        const commentPage = Math.max(1, Number(query.page) || 1);
        const [author, permissions, tag] = await Promise.all([
            loadAuthors(db, [Number(post.authorId)]).then(map => map.get(Number(post.authorId)) ?? null),
            getPostPermissions(userId, post),
            typeof post.tagId === 'string' && ObjectId.isValid(post.tagId)
                ? db.collection('tags').findOne({ _id: new ObjectId(post.tagId) })
                : Promise.resolve(null)
        ]);
        const comments = await buildCommentTree(db, id, {
            page: commentPage,
            limit: COMMENT_PAGE_SIZE,
            viewerId: userId,
            canEditOwn: permissions.canCommentEditOwn,
            canDeleteOwn: permissions.canCommentDeleteOwn,
            canEditAll: permissions.canCommentEditAll,
            canDeleteAll: permissions.canCommentDeleteAll
        });

        const html = await renderPage('post/post_view.html', {
            pagename: String(post.title ?? t('page.postPreview')),
            post_id: id,
            post_doc: {
                ...post,
                createdAt: iso(post.createdAt),
                updatedAt: iso(post.updatedAt)
            },
            author,
            tag: tag ? { id: tag._id.toString(), name: String(tag.name ?? '') } : null,
            comments: comments.comments,
            commentTotal: comments.totalComments,
            commentPage: comments.page,
            commentTotalPages: comments.totalPages,
            canEditPost: permissions.canEditPost,
            canDeletePost: permissions.canDeletePost,
            canComment: permissions.canComment
        });
        return reply.type('text/html').send(html);
    });

    // ------------------------------------------------------------------
    // 用户主页：帖子 / 评论 / 统计 / 参与标签
    // ------------------------------------------------------------------
    server.get('/user/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const { page = '1', limit = String(FEED_PAGE_SIZE), tab = 'posts' } = request.query as { page?: string; limit?: string; tab?: string };
        applyRequestLocale(request);
        const db = getDB();
        const viewerId = getUserIdFromRequest(request);
        const uid = Number(id);
        if (!Number.isInteger(uid) || uid < 0) {
            return renderNotFound(reply, '用户不存在');
        }
        const user_doc = await db.collection('users').findOne(
            { uid },
            { projection: { password: 0, twofaSecret: 0, _id: 0 } }
        );
        if (!user_doc) {
            return renderNotFound(reply, '用户不存在');
        }
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(50, Math.max(1, Number(limit) || FEED_PAGE_SIZE));
        const activeTab = tab === 'comments' ? 'comments' : 'posts';
        const canViewAll = await privManager.hasPriv(viewerId, 'post:view_all');
        const visibilityFilter = buildVisibilityFilter(viewerId, canViewAll);
        const postFilter: Record<string, unknown> = { ...visibilityFilter, authorId: uid };

        const [postTotal, allTags, visiblePostIds] = await Promise.all([
            db.collection('posts').countDocuments(postFilter),
            loadTags(db, { ...visibilityFilter, authorId: uid }),
            db.collection('posts').find(postFilter, { projection: { _id: 1 } }).toArray()
        ]);
        const tags = allTags.filter(tag => tag.postCount > 0);
        const visibleIds = visiblePostIds.map(post => String(post._id));

        const commentFilter: Record<string, unknown> = {
            authorId: uid,
            deleted: { $ne: true },
            postId: { $in: visibleIds }
        };
        const commentTotal = visibleIds.length === 0
            ? 0
            : await db.collection('comments').countDocuments(commentFilter);

        const total = activeTab === 'comments' ? commentTotal : postTotal;
        const totalPages = Math.max(1, Math.ceil(total / limitNum));
        const currentPage = Math.min(pageNum, totalPages);
        const skip = (currentPage - 1) * limitNum;

        let posts: DecoratedPost[] = [];
        const comments: Array<Record<string, unknown>> = [];
        if (activeTab === 'posts') {
            const rawPosts = await db.collection('posts')
                .find(postFilter)
                .sort({ pinned: -1, pinnedAt: -1, createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .toArray();
            posts = await decoratePosts(db, rawPosts as Record<string, unknown>[]);
        } else if (visibleIds.length > 0) {
            const rawComments = await db.collection('comments')
                .find(commentFilter)
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limitNum)
                .toArray();
            const commentPostIds = [...new Set(rawComments.map(comment => String(comment.postId)))];
            const validCommentPostIds = commentPostIds.filter(value => ObjectId.isValid(value));
            const postDocs = validCommentPostIds.length > 0
                ? await db.collection('posts').find({ _id: { $in: validCommentPostIds.map(value => new ObjectId(value)) } }).toArray()
                : [];
            const postMap = new Map(postDocs.map(doc => [doc._id.toString(), String(doc.title ?? '')]));
            for (const comment of rawComments) {
                const postId = String(comment.postId);
                const content = String(comment.content ?? '');
                comments.push({
                    id: String(comment._id),
                    content: stripMarkdown(content, 220),
                    createdAt: iso(comment.createdAt),
                    edited: Boolean(comment.editedAt),
                    postId,
                    postTitle: postMap.get(postId) ?? ''
                });
            }
        }

        const html = await renderPage('user_home.html', {
            pagename: String(user_doc.username ?? t('page.userProfile')),
            user_doc,
            uid,
            posts,
            comments,
            total,
            page: currentPage,
            limit: limitNum,
            totalPages,
            activeTab,
            stats: {
                posts: postTotal,
                comments: commentTotal
            },
            tags
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