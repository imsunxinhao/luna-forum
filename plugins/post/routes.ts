import { Db, ObjectId } from 'mongodb';
import { KernelAPI } from '../../src/types.js';
import { Post, PostSchema } from './types.js';
import { Static, StaticDecode, Type } from '@sinclair/typebox'
import { FastifyInstance, FastifyRequest } from 'fastify';
import { ErrorBase as ErrorBaseType, ErrorBaseSchema } from '../../src/schema.js';
import { renderMarkdown } from './render.js';
import { formatRelativeTime } from './home.js';
import { isFormRequest } from '../../src/auth.js';

const POST_MAGIC = 2;
const PRIV_POST_CREATE = POST_MAGIC + 0;
// const PRIV_POST_EDIT = POST_MAGIC + 1;
// const PRIV_POST_DELETE = POST_MAGIC + 2;
// const PRIV_POST_VIEW = POST_MAGIC + 3;
const PRIV_VIEW_ALL_POST = POST_MAGIC + 4;
const VISIBILITY_PUBLIC = 0;
// const VISIBILITY_PRIVATE = 1;
const VISIBILITY_HIDDEN = 2;

async function canViewPost(db: Db, post: Post, userId: number, kernel: KernelAPI) {
    if (!post) return false;

    if (await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST)) return true;

    if (post.authorId === userId) return true;

    if (post.visibility === VISIBILITY_PUBLIC || post.visibility === undefined) return true;

    return false;
}

function buildVisibilityFilter(userId: number, canView: boolean) {
    if (canView) return {};

    return {
        $or: [
            { visibility: VISIBILITY_PUBLIC },
            { visibility: { $exists: false } },
            { authorId: userId }
        ]
    };
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

export function setupPostRoutes(server: FastifyInstance, kernel: KernelAPI) {
    const listQuerySchema = Type.Object({
        page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
        limit: Type.Optional(Type.Number({ minimum: 1, default: 20 })),
        tagId: Type.Optional(Type.String())
    })
    const listReplySchema = Type.Object({
        posts: Type.Array(Type.Any())
    })
    server.get<{
        Querystring: Static<typeof listQuerySchema>,
        Reply: StaticDecode<typeof listReplySchema> | ErrorBaseType
    }>('/api/v1/post/list', {
        schema: {
            querystring: listQuerySchema,
            response: {
                200: listReplySchema
            }
        }
    },
        async (request) => {
            const userId = kernel.getUserIdFromRequest(request);

            const { page = 1, limit = 20, tagId } = request.query;

            const canView = await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST);

            const db = kernel.getDB();

            let filter: Record<string, unknown> = buildVisibilityFilter(userId, canView); // TODO: use type

            if (tagId) filter = { ...filter, tagId };

            await kernel.callHook('post:beforeList', { userId, page, limit, filter });

            const skip = (page - 1) * limit;

            const posts = await db.collection('posts')
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray();

            const total = await db
                .collection('posts')
                .countDocuments(filter);

            const enriched = await kernel.callHook('post:afterList', {
                posts,
                total,
                page,
                limit,
                userId
            });

            let result = {
                posts: posts, // TODO: Masked
                total,
            };

            for (const e of enriched) {
                if (e && typeof e === 'object')
                    result = { ...result, ...e };
            }

            return result;
        }
    );

    const getParamSchema = Type.Object({ id: Type.String() })
    const getReplySchema = Type.Object({
        post: PostSchema
    })
    server.get<{
        Params: Static<typeof getParamSchema>,
        Reply: StaticDecode<typeof getReplySchema> | ErrorBaseType
    }>('/api/v1/post/:id', {
        schema: {
            params: getParamSchema,
            response: {
                200: getReplySchema,
                404: ErrorBaseSchema,
                403: ErrorBaseSchema
            }
        }
    }, async (request, reply) => {
        const { id } = request.params;

        const userId = kernel.getUserIdFromRequest(request);

        const db = kernel.getDB();

        await kernel.callHook('post:beforeView', { id, userId });

        const post = await db
            .collection('posts')
            .findOne({
                _id: new ObjectId(id)
            }) as Post | null;

        if (!post) {
            return reply.code(404).send({
                message: 'Post not found'
            }
            );
        }

        if (!(await canViewPost(db, post, userId, kernel))) {
            return reply.code(403).send({
                message: 'No permission to view post'
            });
        }

        const enriched = await kernel.callHook('post:afterView', { post, userId });

        let result = { post };

        for (const e of enriched) {
            if (e && typeof e === 'object') result = { ...result, ...e };
        }

        return result;
    });

    const createBodySchema = Type.Object({
        title: Type.String(),
        content: Type.String(),
        tagId: Type.Optional(Type.String()),
        visibility: Type.Optional(Type.Number())
    })
    server.post<{
        Body: Static<typeof createBodySchema>
    }>('/api/v1/post/create', {
        schema: {
            body: createBodySchema
        }
    }, async (request, reply) => {
        const { title, content, tagId, visibility } = request.body;

        const userId = kernel.getUserIdFromRequest(request);

        const canCreate = await kernel.hasPriv(userId, PRIV_POST_CREATE);

        const db = kernel.getDB()

        if (!canCreate) {
            if (isFormRequest(request)) {
                request.flash('error', userId === 0 ? '请先登录后发帖' : '您没有权限发帖');
                return reply.redirect(userId === 0 ? '/login' : '/post/new');
            }
            return reply.code(403).send({ success: false, error: 'No permission to create post' });
        }

        if (!title || !content) {
            if (isFormRequest(request)) {
                request.flash('error', '标题和内容不能为空');
                request.flash('formTitle', title || '');
                request.flash('formContent', content || '');
                return reply.redirect('/post/new');
            }
            return reply.code(400).send({ success: false, error: 'Title and content are required' });
        }

        if (visibility === VISIBILITY_HIDDEN && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))) {
            return reply.code(403).send({ success: false, error: 'Cannot create hidden post' });
        }

        const finalVisibility = (
            visibility === VISIBILITY_HIDDEN
            && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))
        )
            ? VISIBILITY_PUBLIC
            : visibility ?? VISIBILITY_PUBLIC;

        const post: Post = {
            title,
            content,
            authorId: userId,
            visibility: finalVisibility,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (tagId) {
            const tag = await db
                .collection('tags')
                .findOne({ _id: new ObjectId(tagId) });

            if (tag) post.tagId = tagId;
        }

        const modified = await kernel.callHook('post:beforeCreate', post);

        let finalPost = post;

        for (const e of modified) {
            if (e && typeof e === 'object') finalPost = { ...finalPost, ...e };
        }

        const result = await db.collection('posts').insertOne(finalPost);

        const newPost = { ...finalPost, _id: result.insertedId };

        const enriched = await kernel.callHook('post:afterCreate', newPost);

        let finalResult = newPost;

        for (const e of enriched) {
            if (e && typeof e === 'object') finalResult = { ...finalResult, ...e };

        }
        if (isFormRequest(request)) {
            return reply.redirect(`/post/${String(result.insertedId)}`);
        }
        return reply.code(201).send({ post: finalResult });
    });

    const replaceParamsSchema = Type.Object({
        id: Type.String()
    })
    server.put<{
        Body: Post,
        Params: Static<typeof replaceParamsSchema>
    }>('/api/v1/post/:id', {
        schema: {
            body: PostSchema,
            params: replaceParamsSchema
        }
    }, async (request, reply) => {
        const { id } = request.params;

        const { title, content, visibility } = request.body;

        const userId = kernel.getUserIdFromRequest(request);

        const db = kernel.getDB();

        const oldPost = await db
            .collection('posts')
            .findOne({ _id: new ObjectId(id) });

        if (!oldPost) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }

        if (oldPost.authorId !== userId && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))) {
            return reply.code(403).send({ success: false, error: 'No permission to edit this post' });
        }

        const isAdmin = await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST);

        if (visibility !== undefined && !isAdmin && visibility === VISIBILITY_HIDDEN) {
            return reply.code(403).send({ success: false, error: 'Cannot set post to hidden' });
        }

        await kernel.callHook('post:beforeEdit', { id, title, content, visibility, userId, oldPost });

        const update: Partial<Post> = { updatedAt: new Date().toISOString() };

        if (title !== undefined) update.title = title;
        if (content !== undefined) update.content = content;
        if (visibility !== undefined) update.visibility = visibility;
        if (content !== undefined && content !== oldPost.content) {
            await db.collection('post_edits').insertOne({
                postId: id,
                oldContent: oldPost.content,
                newContent: content,
                editedBy: userId,
                editedAt: new Date()
            });
        }

        const result = await db.collection('posts').updateOne(
            { _id: new ObjectId(id) },
            { $set: update }
        );

        if (result.modifiedCount === 0) {
            return reply.code(404).send({ success: false, error: 'Post not found or not authorized' });
        }

        await kernel.callHook('post:afterEdit', { id, title, content, visibility, userId });

        return { success: true, modified: true };
    });

    const getEditsParamsSchema = Type.Object({
        id: Type.String()
    })
    server.get<{
        Params: Static<typeof getEditsParamsSchema>
    }>('/api/v1/post/:id/edits', {
        schema: {
            params: getEditsParamsSchema
        }
    }, async (request, reply) => {
        const { id } = request.params;

        const userId = kernel.getUserIdFromRequest(request);

        const db = kernel.getDB();

        const post = await db
            .collection('posts')
            .findOne({ _id: new ObjectId(id) }) as Post | null;

        if (!post) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }

        if (!(await canViewPost(db, post, userId, kernel))) {
            return reply.code(403).send({ success: false, error: 'No permission to view post' });
        }

        const edits = await db.collection('post_edits')
            .find({ postId: id })
            .sort({ editedAt: -1 })
            .toArray();

        return { success: true, edits };
    });

    const deleteParamsSchema = Type.Object({
        id: Type.String()
    })
    server.delete<{
        Params: Static<typeof deleteParamsSchema>,
        Reply: void
    }>('/api/v1/post/:id', {
        schema: {
            params: deleteParamsSchema,
            response: {
                204: Type.Null({})
            }
        }
    }, async (request, reply) => {
        const { id } = request.params;

        const userId = kernel.getUserIdFromRequest(request);

        const db = kernel.getDB();

        const post = await db
            .collection('posts')
            .findOne({ _id: new ObjectId(id) });

        if (!post) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }

        if (post.authorId !== userId && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))) {
            return reply.code(403).send({ success: false, error: 'No permission to delete this post' });
        }

        await kernel.callHook('post:beforeDelete', post);

        const result = await db.collection('posts').deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }

        await kernel.callHook('post:afterDelete', post);

        return reply.code(204).send();
    });

    // 发帖页
    server.get('/post/new', async (request, reply) => {
        const userId = kernel.getUserIdFromRequest(request);
        const db = kernel.getDB();

        const error = getFlash(request, 'error');
        const formTitle = getFlash(request, 'formTitle') ?? '';
        const formContent = getFlash(request, 'formContent') ?? '';

        const canCreate = await kernel.hasPriv(userId, PRIV_POST_CREATE);

        const tags = await db.collection('tags').find().sort({ sortOrder: 1 }).toArray();
        const enrichedTags = tags.map((tag) => ({
            ...tag,
            id: String(tag._id)
        }));

        const html = await kernel.executeCommand('template:renderPage', 'post-new.html', {
            pagename: '发帖',
            tags: enrichedTags,
            canCreate,
            error,
            formTitle,
            formContent
        });

        return reply.type('text/html').send(html);
    });

    // 帖子详情 / 预览页（Markdown + KaTeX 渲染）
    server.get('/post/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const userId = kernel.getUserIdFromRequest(request);
        const db = kernel.getDB();

        const renderError = (error: string) => kernel.executeCommand(
            'template:renderPage', 'post.html', { pagename: '帖子', error }
        );

        if (!ObjectId.isValid(id)) {
            const html = await renderError('帖子不存在');
            return reply.code(404).type('text/html').send(html);
        }

        const post = await db.collection('posts').findOne({ _id: new ObjectId(id) }) as (Post & { _id: ObjectId }) | null;

        if (!post) {
            const html = await renderError('帖子不存在');
            return reply.code(404).type('text/html').send(html);
        }

        if (!(await canViewPost(db, post, userId, kernel))) {
            const html = await renderError('你没有权限查看此帖子');
            return reply.code(403).type('text/html').send(html);
        }

        await kernel.callHook('post:beforeView', { id, userId });

        const author = post.authorId != null
            ? await db.collection('users').findOne({ uid: post.authorId })
            : null;
        const authorName = (author as { username?: string } | null)?.username ?? '未知用户';

        const tag = post.tagId
            ? await db.collection('tags').findOne({ _id: new ObjectId(post.tagId) })
            : null;
        const tagName = (tag as { name?: string } | null)?.name ?? undefined;

        const contentHtml = renderMarkdown(String(post.content ?? ''));

        const html = await kernel.executeCommand('template:renderPage', 'post.html', {
            pagename: post.title,
            post: {
                ...post,
                id: String(post._id),
                authorName,
                authorInitial: authorName ? authorName[0] : '?',
                tagName,
                createdAtLabel: formatRelativeTime(post.createdAt),
                contentHtml
            }
        });

        return reply.type('text/html').send(html);
    });
}