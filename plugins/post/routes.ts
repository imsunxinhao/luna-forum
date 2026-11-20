import { Db, ObjectId, UpdateFilter, Document } from 'mongodb';
import { KernelAPI } from '../../src/types.js';
import { Post } from './types.js';
import { Static, StaticDecode, Type } from '@sinclair/typebox'
import { FastifyInstance } from 'fastify';
import { ErrorBase as ErrorBaseType, ErrorBaseSchema } from '../../src/schema.js';
import { buildVisibilityFilter, canViewPost, VISIBILITY_PUBLIC } from './access.js';
import { buildCommentTree, CommentDoc, getCommentView, syncCommentCount } from './comments.js';

function parseObjectId(value: string): ObjectId | null {
    return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

async function findComment(db: Db, id: string): Promise<CommentDoc | null> {
    const oid = parseObjectId(id);
    if (!oid) return null;
    return await db.collection<CommentDoc>('comments').findOne({ _id: oid });
}

export function setupPostRoutes(server: FastifyInstance, kernel: KernelAPI) {
    const listQuerySchema = Type.Object({
        page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
        limit: Type.Optional(Type.Number({ minimum: 1, default: 20 })),
        tagId: Type.Optional(Type.String())
    })
    const listReplySchema = Type.Object({
        posts: Type.Array(Type.Any()),
        total: Type.Number(),
        page: Type.Number(),
        limit: Type.Number(),
        totalPages: Type.Number()
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
            const canView = await kernel.hasPriv(userId, 'post:view_all');
            const db = kernel.getDB();
            let filter: Record<string, unknown> = buildVisibilityFilter(userId, canView);
            if (tagId) filter = { ...filter, tagId };
            await kernel.callHook('post:beforeList', { userId, page, limit, filter });
            const skip = (page - 1) * limit;
            const posts = await db.collection('posts')
                .find(filter)
                .sort({ pinned: -1, pinnedAt: -1, createdAt: -1 })
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
                posts: posts,
                total,
                page,
                limit,
                totalPages: Math.max(1, Math.ceil(total / limit))
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
        post: Type.Any()
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
        const oid = parseObjectId(id);
        if (!oid) {
            return reply.code(404).send({ message: 'Post not found' });
        }
        const userId = kernel.getUserIdFromRequest(request);
        const db = kernel.getDB();
        await kernel.callHook('post:beforeView', { id, userId });
        const post = await db
            .collection('posts')
            .findOne({
                _id: oid
            }) as Post | null;
        if (!post) {
            return reply.code(404).send({
                message: 'Post not found'
            }
            );
        }
        const canViewAll = await kernel.hasPriv(userId, 'post:view_all');
        if (!canViewPost(post, userId, canViewAll)) {
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
        title: Type.String({ minLength: 1, maxLength: 200 }),
        content: Type.String({ minLength: 1, maxLength: 100000 }),
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
        const canCreate = await kernel.hasPriv(userId, 'post:create');
        const db = kernel.getDB()
        if (!canCreate) {
            return reply.code(403).send({ success: false, error: 'No permission to create post' });
        }
        const canHide = await kernel.hasPriv(userId, 'post:view_all');
        if (visibility !== undefined && !canHide && visibility !== VISIBILITY_PUBLIC) {
            return reply.code(403).send({ success: false, error: 'Cannot create non-public post' });
        }
        const finalVisibility = visibility ?? VISIBILITY_PUBLIC;
        const now = new Date().toISOString();
        const post: Post = {
            title,
            content,
            authorId: userId,
            visibility: finalVisibility,
            createdAt: now,
            updatedAt: now,
            commentCount: 0
        };
        if (tagId) {
            if (!ObjectId.isValid(tagId)) {
                return reply.code(400).send({ success: false, error: 'Invalid tag id' });
            }
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
        return reply.code(201).send({ success: true, post: finalResult });
    });

    const replaceParamsSchema = Type.Object({
        id: Type.String()
    })
    const updateBodySchema = Type.Object({
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        content: Type.Optional(Type.String({ minLength: 1, maxLength: 100000 })),
        tagId: Type.Optional(Type.String()),
        visibility: Type.Optional(Type.Number())
    })
    server.put<{
        Body: Static<typeof updateBodySchema>,
        Params: Static<typeof replaceParamsSchema>
    }>('/api/v1/post/:id', {
        schema: {
            body: updateBodySchema,
            params: replaceParamsSchema
        }
    }, async (request, reply) => {
        const { id } = request.params;
        const { title, content, tagId, visibility } = request.body;
        const userId = kernel.getUserIdFromRequest(request);
        const db = kernel.getDB();
        const oid = parseObjectId(id);
        if (!oid) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const oldPost = await db
            .collection('posts')
            .findOne({ _id: oid });
        if (!oldPost) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const isOwner = oldPost.authorId === userId;
        const canEdit = isOwner
            ? await kernel.hasPriv(userId, 'post:edit_own')
            : await kernel.hasPriv(userId, 'post:edit_all');
        if (!canEdit) {
            return reply.code(403).send({ success: false, error: 'No permission to edit this post' });
        }
        const canHide = await kernel.hasPriv(userId, 'post:view_all');
        if (visibility !== undefined && !canHide && visibility !== VISIBILITY_PUBLIC) {
            return reply.code(403).send({ success: false, error: 'Cannot set post to non-public' });
        }
        const now = new Date().toISOString();
        const set: Record<string, unknown> = { updatedAt: now };
        const unset: Record<string, unknown> = {};
        if (title !== undefined) set.title = title;
        if (content !== undefined) set.content = content;
        if (visibility !== undefined) set.visibility = visibility;
        if (tagId !== undefined) {
            if (tagId === '') {
                unset.tagId = '';
            } else {
                if (!ObjectId.isValid(tagId)) {
                    return reply.code(400).send({ success: false, error: 'Invalid tag id' });
                }
                const tag = await db.collection('tags').findOne({ _id: new ObjectId(tagId) });
                if (!tag) {
                    return reply.code(400).send({ success: false, error: 'Tag not found' });
                }
                set.tagId = tagId;
            }
        }
        await kernel.callHook('post:beforeEdit', { id, title, content, visibility, userId, oldPost });
        if (content !== undefined && content !== oldPost.content) {
            await db.collection('post_edits').insertOne({
                postId: id,
                oldContent: oldPost.content,
                newContent: content,
                editedBy: userId,
                editedAt: new Date()
            });
        }
        const update: UpdateFilter<Document> = { $set: set };
        if (Object.keys(unset).length > 0) update.$unset = unset;
        const result = await db.collection('posts').updateOne(
            { _id: oid },
            update
        );
        if (result.modifiedCount === 0 && result.matchedCount === 0) {
            return reply.code(404).send({ success: false, error: 'Post not found or not authorized' });
        }
        const newPost: Record<string, unknown> = { ...oldPost, ...set };
        if (unset.tagId !== undefined) delete newPost.tagId;
        await kernel.callHook('post:afterEdit', { id, title, content, visibility, userId, oldPost, newPost });
        return { success: true, modified: true, post: newPost };
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
        const oid = parseObjectId(id);
        if (!oid) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const userId = kernel.getUserIdFromRequest(request);
        const db = kernel.getDB();
        const post = await db
            .collection('posts')
            .findOne({ _id: oid }) as Post | null;
        if (!post) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const canViewAll = await kernel.hasPriv(userId, 'post:view_all');
        if (!canViewPost(post, userId, canViewAll)) {
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
        const oid = parseObjectId(id);
        if (!oid) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const userId = kernel.getUserIdFromRequest(request);
        const db = kernel.getDB();
        const post = await db
            .collection('posts')
            .findOne({ _id: oid });
        if (!post) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const isOwner = post.authorId === userId;
        const canDelete = isOwner
            ? await kernel.hasPriv(userId, 'post:delete_own')
            : await kernel.hasPriv(userId, 'post:delete_all');
        if (!canDelete) {
            return reply.code(403).send({ success: false, error: 'No permission to delete this post' });
        }
        await kernel.callHook('post:beforeDelete', post);
        const result = await db.collection('posts').deleteOne({ _id: oid });
        if (result.deletedCount === 0) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        await db.collection('comments').deleteMany({ postId: id });
        await db.collection('post_edits').deleteMany({ postId: id });
        await kernel.callHook('post:afterDelete', post);
        return reply.code(204).send();
    });

    // ------------------------------------------------------------------
    // 评论
    // ------------------------------------------------------------------

    const commentsQuerySchema = Type.Object({
        page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
        limit: Type.Optional(Type.Number({ minimum: 1, default: 50 }))
    })
    server.get<{
        Params: Static<typeof getParamSchema>,
        Querystring: Static<typeof commentsQuerySchema>
    }>('/api/v1/post/:id/comments', {
        schema: {
            params: getParamSchema,
            querystring: commentsQuerySchema
        }
    }, async (request, reply) => {
        const { id } = request.params;
        const oid = parseObjectId(id);
        if (!oid) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const userId = kernel.getUserIdFromRequest(request);
        const db = kernel.getDB();
        const canViewAll = await kernel.hasPriv(userId, 'post:view_all');
        const post = await db.collection('posts').findOne({ _id: oid }) as Post | null;
        if (!post) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        if (!canViewPost(post, userId, canViewAll)) {
            return reply.code(403).send({ success: false, error: 'No permission to view this post' });
        }
        const [canEditOwn, canDeleteOwn, canEditAll, canDeleteAll] = await Promise.all([
            kernel.hasPriv(userId, 'post:comment_edit_own'),
            kernel.hasPriv(userId, 'post:comment_delete_own'),
            kernel.hasPriv(userId, 'post:comment_edit_all'),
            kernel.hasPriv(userId, 'post:comment_delete_all')
        ]);
        const page = await buildCommentTree(db, id, {
            page: request.query.page,
            limit: request.query.limit,
            viewerId: userId,
            canEditOwn,
            canDeleteOwn,
            canEditAll,
            canDeleteAll
        });
        return { success: true, ...page };
    });

    const createCommentParamsSchema = Type.Object({
        id: Type.String()
    });
    const createCommentBodySchema = Type.Object({
        content: Type.String({ minLength: 1, maxLength: 20000 }),
        parentId: Type.Optional(Type.String())
    });

    server.post<{
        Params: Static<typeof createCommentParamsSchema>,
        Body: Static<typeof createCommentBodySchema>
    }>('/api/v1/post/:id/comment', {
        schema: {
            params: createCommentParamsSchema,
            body: createCommentBodySchema
        }
    }, async (request, reply) => {
        const { id } = request.params;
        const { content, parentId } = request.body;
        const userId = kernel.getUserIdFromRequest(request);

        if (!userId) {
            return reply.code(401).send({ success: false, error: 'Login required' });
        }
        const trimmed = content.trim();
        if (!trimmed) {
            return reply.code(400).send({ success: false, error: 'Empty content' });
        }

        const db = kernel.getDB();
        const oid = parseObjectId(id);
        if (!oid) {
            return reply.code(400).send({ success: false, error: 'Invalid post id' });
        }

        const post = await db.collection('posts').findOne({ _id: oid }) as Post | null;
        if (!post) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }
        const canViewAll = await kernel.hasPriv(userId, 'post:view_all');
        if (!canViewPost(post, userId, canViewAll)) {
            return reply.code(403).send({ success: false, error: 'No permission to comment on this post' });
        }
        const canComment = await kernel.hasPriv(userId, 'post:comment_create');
        if (!canComment) {
            return reply.code(403).send({ success: false, error: 'No permission to comment' });
        }

        let rootId: string | undefined;
        let replyToId: string | undefined;
        if (parentId) {
            const parent = await findComment(db, parentId);
            if (!parent || parent.postId !== id) {
                return reply.code(404).send({ success: false, error: 'Parent comment not found' });
            }
            if (parent.deleted) {
                return reply.code(400).send({ success: false, error: 'Cannot reply to a deleted comment' });
            }
            replyToId = parent._id.toString();
            rootId = typeof parent.parentId === 'string' ? parent.parentId : replyToId;
        }

        const now = new Date().toISOString();
        const comment: Record<string, unknown> = {
            postId: id,
            authorId: userId,
            content: trimmed,
            visibility: VISIBILITY_PUBLIC,
            createdAt: now,
            updatedAt: now
        };
        if (rootId) comment.parentId = rootId;
        if (replyToId) comment.replyToId = replyToId;

        const modified = await kernel.callHook('comment:beforeCreate', comment);
        let finalComment = comment;
        for (const e of modified) {
            if (e && typeof e === 'object') finalComment = { ...finalComment, ...e };
        }

        const result = await db.collection('comments').insertOne(finalComment);
        await syncCommentCount(db, id);

        const created = { ...finalComment, _id: result.insertedId } as unknown as CommentDoc;
        const view = await getCommentView(db, created, {
            viewerId: userId,
            canEditOwn: await kernel.hasPriv(userId, 'post:comment_edit_own'),
            canDeleteOwn: await kernel.hasPriv(userId, 'post:comment_delete_own'),
            canEditAll: await kernel.hasPriv(userId, 'post:comment_edit_all'),
            canDeleteAll: await kernel.hasPriv(userId, 'post:comment_delete_all')
        });

        await kernel.callHook('comment:afterCreate', view);

        return reply.code(201).send({ success: true, comment: view });
    });

    const commentParamsSchema = Type.Object({
        id: Type.String()
    });
    const updateCommentBodySchema = Type.Object({
        content: Type.String({ minLength: 1, maxLength: 20000 })
    });

    server.put<{
        Params: Static<typeof commentParamsSchema>,
        Body: Static<typeof updateCommentBodySchema>
    }>('/api/v1/comment/:id', {
        schema: {
            params: commentParamsSchema,
            body: updateCommentBodySchema
        }
    }, async (request, reply) => {
        const { id } = request.params;
        const userId = kernel.getUserIdFromRequest(request);
        const trimmed = request.body.content.trim();
        if (!trimmed) {
            return reply.code(400).send({ success: false, error: 'Empty content' });
        }
        const db = kernel.getDB();
        const comment = await findComment(db, id);
        if (!comment) {
            return reply.code(404).send({ success: false, error: 'Comment not found' });
        }
        if (comment.deleted) {
            return reply.code(400).send({ success: false, error: 'Cannot edit a deleted comment' });
        }
        const isOwner = comment.authorId === userId;
        const canEdit = isOwner
            ? await kernel.hasPriv(userId, 'post:comment_edit_own')
            : await kernel.hasPriv(userId, 'post:comment_edit_all');
        if (!canEdit) {
            return reply.code(403).send({ success: false, error: 'No permission to edit this comment' });
        }
        const now = new Date().toISOString();
        await kernel.callHook('comment:beforeEdit', { id, content: trimmed, userId, oldComment: comment });
        await db.collection('comments').updateOne(
            { _id: comment._id },
            { $set: { content: trimmed, updatedAt: now, editedAt: now } }
        );
        const updated: CommentDoc = { ...comment, content: trimmed, updatedAt: now, editedAt: now };
        const view = await getCommentView(db, updated, {
            viewerId: userId,
            canEditOwn: await kernel.hasPriv(userId, 'post:comment_edit_own'),
            canDeleteOwn: await kernel.hasPriv(userId, 'post:comment_delete_own'),
            canEditAll: await kernel.hasPriv(userId, 'post:comment_edit_all'),
            canDeleteAll: await kernel.hasPriv(userId, 'post:comment_delete_all')
        });
        await kernel.callHook('comment:afterEdit', view);
        return { success: true, comment: view };
    });

    server.delete<{
        Params: Static<typeof commentParamsSchema>
    }>('/api/v1/comment/:id', {
        schema: {
            params: commentParamsSchema
        }
    }, async (request, reply) => {
        const { id } = request.params;
        const userId = kernel.getUserIdFromRequest(request);
        const db = kernel.getDB();
        const comment = await findComment(db, id);
        if (!comment) {
            return reply.code(404).send({ success: false, error: 'Comment not found' });
        }
        if (comment.deleted) {
            return { success: true, deleted: true, id };
        }
        const isOwner = comment.authorId === userId;
        const canDelete = isOwner
            ? await kernel.hasPriv(userId, 'post:comment_delete_own')
            : await kernel.hasPriv(userId, 'post:comment_delete_all');
        if (!canDelete) {
            return reply.code(403).send({ success: false, error: 'No permission to delete this comment' });
        }
        const now = new Date().toISOString();
        await kernel.callHook('comment:beforeDelete', comment, { userId });
        await db.collection('comments').updateOne(
            { _id: comment._id },
            { $set: { deleted: true, deletedAt: now, updatedAt: now, content: '' } }
        );
        await syncCommentCount(db, comment.postId);
        await kernel.callHook('comment:afterDelete', comment, { userId });
        return { success: true, deleted: true, id };
    });
}
