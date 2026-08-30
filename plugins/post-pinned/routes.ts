import { ObjectId } from 'mongodb'
import { KernelAPI } from '../../src/types.js'
import { FastifyInstance } from 'fastify'
import { IdParams } from './types.js'

export function setupPostPinnedRoutes(server: FastifyInstance, kernel: KernelAPI): void {
    server.put<{ Params: IdParams }>('/api/v1/post/:id/pin', async (request, reply) => {
        const { id } = request.params
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()
        const canPin = await kernel.hasPriv(userId, 'post-pinned:pin')
        if (!canPin) {
            return reply.code(403).send({ success: false, error: 'No permission to pin post' })
        }
        const result = await db.collection('posts').updateOne(
            { _id: new ObjectId(id) },
            { $set: { pinned: true, pinnedAt: new Date() } }
        )
        if (result.modifiedCount === 0) {
            return reply.code(404).send({ success: false, error: 'Post not found' })
        }
        return { success: true, pinned: true }
    })
    server.put<{ Params: IdParams }>('/api/v1/post/:id/unpin', async (request, reply) => {
        const { id } = request.params
        const userId = kernel.getUserIdFromRequest(request)
        const db = kernel.getDB()
        const canUnpin = await kernel.hasPriv(userId, 'post-pinned:unpin')
        if (!canUnpin) {
            return reply.code(403).send({ success: false, error: 'No permission to unpin post' })
        }
        const result = await db.collection('posts').updateOne(
            { _id: new ObjectId(id) },
            { $set: { pinned: false }, $unset: { pinnedAt: '' } }
        )
        if (result.modifiedCount === 0) {
            return reply.code(404).send({ success: false, error: 'Post not found' })
        }
        return { success: true, unpinned: true }
    })
    server.get('/api/v1/post/pinned', async () => {
        const db = kernel.getDB()
        const posts = await db.collection('posts')
            .find({ pinned: true })
            .sort({ pinnedAt: -1 })
            .toArray()
        return { success: true, posts }
    })
}