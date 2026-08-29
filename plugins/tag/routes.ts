import { Db, ObjectId } from 'mongodb'
import { KernelAPI } from '../../src/types.js'
import { FastifyInstance } from 'fastify'
import { CreateTagBody, IdAndPostIdParams, DeletePostParams, UpdateTagBody, SortTagBody, MoveTagBody, ModeratorBody, IdParams, PostsQuery } from './types.js';

async function isTagMod(db: Db, tagId: string, userId: number) {
    const tag = await db
        .collection('tags')
        .findOne({ _id: new ObjectId(tagId) })

    if (!tag) return false

    return (tag.moderators || []).includes(userId)
}

export function setupTagRoutes(server: FastifyInstance, kernel: KernelAPI) {
    server.post<{ Body: CreateTagBody }>('/api/v1/tag/create', async (request, reply) => {
        const { name, parentId, sortOrder } = request.body
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()

        const canCreate = await kernel.hasPriv(userId, 'tag:create')
        if (!canCreate) {
            return reply.code(403).send({ error: 'No permission to create tag' })
        }

        const existing = await db.collection('tags').findOne({ name })
        if (existing) {
            return reply.code(409).send({ error: 'Tag already exists' })
        }

        if (parentId) {
            const parent = await db.collection('tags').findOne({ _id: new ObjectId(parentId) })
            if (!parent) {
                return reply.code(404).send({ error: 'Parent tag not found' })
            }
        }

        const maxOrder = await db.collection('tags')
            .find({ parentId: parentId || null })
            .sort({ sortOrder: -1 })
            .limit(1)
            .toArray()

        const order = sortOrder ?? (maxOrder.length > 0 ? maxOrder[0].sortOrder + 1 : 0)

        const tag = {
            name,
            parentId: parentId || null,
            sortOrder: order,
            moderators: [],
            requireTag: false,
            createdAt: new Date()
        }

        const result = await db.collection('tags').insertOne(tag)

        return reply.code(201).send({ ...tag, _id: result.insertedId })
    })

    server.put<{ Params: IdParams; Body: UpdateTagBody }>('/api/v1/tag/:id', async (request, reply) => {
        const { id } = request.params
        const { name, sortOrder, requireTag } = request.body
        const userId = kernel.getUserIdFromRequest(request)
        const canEdit = await kernel.hasPriv(userId, 'tag:edit')
        const db = kernel.getDB()

        if (!canEdit) {
            return reply.code(403).send({ error: 'No permission to edit tag' })
        }

        const update: { updatedAt: Date; name?: string; sortOrder?: number; requireTag?: boolean } = { updatedAt: new Date() }
        if (name !== undefined) update.name = name
        if (sortOrder !== undefined) update.sortOrder = sortOrder
        if (requireTag !== undefined) update.requireTag = requireTag

        const result = await db.collection('tags').updateOne(
            { _id: new ObjectId(id) },
            { $set: update }
        )

        if (result.modifiedCount === 0) {
            return reply.code(404).send({ error: 'Tag not found' })
        }

        return { modified: true }
    })

    server.delete<{ Params: IdParams }>('/api/v1/tag/:id', async (request, reply) => {
        const { id } = request.params
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()

        const canDelete = await kernel.hasPriv(userId, 'tag:delete')
        if (!canDelete) {
            return reply.code(403).send({ error: 'No permission to delete tag' })
        }

        const children = await db.collection('tags').findOne({ parentId: id })
        if (children) {
            return reply.code(400).send({ error: 'Tag has sub-tags, delete them first' })
        }

        const result = await db.collection('tags').deleteOne({ _id: new ObjectId(id) })
        if (result.deletedCount === 0) {
            return reply.code(404).send({ error: 'Tag not found' })
        }

        return { deleted: true }
    })

    server.put<{ Params: IdParams; Body: SortTagBody }>('/api/v1/tag/:id/sort', async (request, reply) => {
        const { id } = request.params
        const { sortOrder } = request.body
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()

        const canEdit = await kernel.hasPriv(userId, 'tag:edit')
        if (!canEdit) {
            return reply.code(403).send({ error: 'No permission' })
        }

        const result = await db.collection('tags').updateOne(
            { _id: new ObjectId(id) },
            { $set: { sortOrder, updatedAt: new Date() } }
        )

        if (result.modifiedCount === 0) {
            return reply.code(404).send({ error: 'Tag not found' })
        }

        return { modified: true }
    })

    server.put<{ Params: IdParams; Body: MoveTagBody }>('/api/v1/tag/:id/move', async (request, reply) => {
        const { id } = request.params
        const { newParentId } = request.body
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()

        const canEdit = await kernel.hasPriv(userId, 'tag:edit')
        if (!canEdit) {
            return reply.code(403).send({ error: 'No permission' })
        }

        if (newParentId) {
            const parent = await db.collection('tags').findOne({ _id: new ObjectId(newParentId) })
            if (!parent) {
                return reply.code(404).send({ error: 'Parent tag not found' })
            }
        }

        const result = await db.collection('tags').updateOne(
            { _id: new ObjectId(id) },
            { $set: { parentId: newParentId || null, updatedAt: new Date() } }
        )

        if (result.modifiedCount === 0) {
            return reply.code(404).send({ error: 'Tag not found' })
        }

        return { moved: true }
    })

    server.get<{ Params: IdParams; Querystring: PostsQuery }>('/api/v1/tag/list', async () => {
        const db = kernel.getDB()
        const tags = await db.collection('tags')
            .find()
            .sort({ sortOrder: 1 })
            .toArray()
        return { tags }
    })

    server.get<{ Params: IdParams; Querystring: PostsQuery }>('/api/v1/tag/:id', async (request, reply) => {
        const { id } = request.params
        const db = kernel.getDB()
        const tag = await db.collection('tags').findOne({ _id: new ObjectId(id) })
        if (!tag) {
            return reply.code(404).send({ error: 'Tag not found' })
        }
        return tag
    })

    server.get<{ Params: IdParams; Querystring: PostsQuery }>('/api/v1/tag/:id/posts', async (request) => {
        const { id } = request.params
        const { page = 1, limit = 20 } = request.query
        const db = kernel.getDB()
        const skip = (Number(page) - 1) * Number(limit)
        const posts = await db.collection('posts')
            .find({ tagId: id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .toArray()
        const total = await db.collection('posts').countDocuments({ tagId: id })
        return {
            posts,
            total,
            page: Number(page),
            limit: Number(limit)
        }
    })

    server.put<{ Params: IdParams; Body: ModeratorBody }>('/api/v1/tag/:id/moderator/add', async (request, reply) => {
        const { id } = request.params
        const { userId: targetUserId } = request.body
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()
        const canManage = await kernel.hasPriv(userId, 'tag:mod')

        if (!canManage) {
            return reply.code(403).send({ error: 'No permission' })
        }

        const tag = await db.collection('tags').findOne({ _id: new ObjectId(id) })
        if (!tag) {
            return reply.code(404).send({ error: 'Tag not found' })
        }

        const moderators = tag.moderators || []
        if (!moderators.includes(targetUserId)) {
            moderators.push(targetUserId)
        }

        await db.collection('tags').updateOne(
            { _id: new ObjectId(id) },
            { $set: { moderators, updatedAt: new Date() } }
        )

        return { moderators }
    })

    server.put<{ Params: IdParams; Body: ModeratorBody }>('/api/v1/tag/:id/moderator/remove', async (request, reply) => {
        const { id } = request.params
        const { userId: targetUserId } = request.body
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()
        const canManage = await kernel.hasPriv(userId, 'tag:mod')
        if (!canManage) {
            return reply.code(403).send({ error: 'No permission' })
        }

        const tag = await db.collection('tags').findOne({ _id: new ObjectId(id) })
        if (!tag) {
            return reply.code(404).send({ error: 'Tag not found' })
        }

        const moderators = (tag.moderators || []).filter((m: number) => m !== targetUserId)

        await db.collection('tags').updateOne(
            { _id: new ObjectId(id) },
            { $set: { moderators, updatedAt: new Date() } }
        )

        return { moderators }
    })

    server.delete<{ Params: DeletePostParams }>('/api/v1/tag/:id/post/:postId', async (request, reply) => {
        const { id, postId } = request.params
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()
        const mod = await isTagMod(db, id, userId)
        const hasPriv = await kernel.hasPriv(userId, 'tag:mod')

        if (!mod && !hasPriv) {
            return reply.code(403).send({ error: 'Not a moderator of this tag' })
        }

        const result = await db.collection('posts').deleteOne({ _id: new ObjectId(postId), tagId: id })

        if (result.deletedCount === 0) {
            return reply.code(404).send({ error: 'Post not found' })
        }

        return { deleted: true }
    })

    server.put<{ Params: IdAndPostIdParams }>('/api/v1/tag/:id/post/:postId/pin', async (request, reply) => {
        const { id, postId } = request.params
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()
        const mod = await isTagMod(db, id, userId)
        const hasPriv = await kernel.hasPriv(userId, 'tag:mod')

        if (!mod && !hasPriv) {
            return reply.code(403).send({ error: 'Not a moderator of this tag' })
        }

        await db.collection('posts').updateOne(
            { _id: new ObjectId(postId), tagId: id },
            { $set: { pinned: true, pinnedAt: new Date() } }
        )

        return { pinned: true }
    })
}