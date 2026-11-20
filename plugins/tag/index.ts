import type { Plugin } from '../../src/types.js'
import { setupTagRoutes } from './routes.js'
import { ObjectId } from 'mongodb'
import { Post } from './types.js'

const tagPlugin: Plugin = {
    name: 'tag',
    version: '0.1.0',
    deps: [],

    async init(ctx) {
        ctx.registerPriv('create', ['default'])
        ctx.registerPriv('edit', ['superuser'])
        ctx.registerPriv('delete', ['superuser'])
        ctx.registerPriv('mod', ['superuser'])

        await ctx.registerHook('post:afterCreate', async (...args: unknown[]) => {
            const post = args[0] as Post
            if (post.tagId && ObjectId.isValid(post.tagId)) {
                const db = ctx.kernel.getDB()
                await db.collection('tags').updateOne(
                    { _id: new ObjectId(post.tagId) },
                    { $inc: { postCount: 1 } }
                )
            }
        })

        await ctx.registerHook('post:afterEdit', async (...args: unknown[]) => {
            const payload = args[0] as { oldPost?: Post; newPost?: Post }
            const oldTagId = payload?.oldPost?.tagId
            const newTagId = payload?.newPost?.tagId
            if (oldTagId === newTagId) return
            const db = ctx.kernel.getDB()
            if (oldTagId && ObjectId.isValid(oldTagId)) {
                await db.collection('tags').updateOne(
                    { _id: new ObjectId(oldTagId) },
                    { $inc: { postCount: -1 } }
                )
            }
            if (newTagId && ObjectId.isValid(newTagId)) {
                await db.collection('tags').updateOne(
                    { _id: new ObjectId(newTagId) },
                    { $inc: { postCount: 1 } }
                )
            }
        })

        await ctx.registerHook('post:afterDelete', async (...args: unknown[]) => {
            const post = args[0] as Post
            if (post && post.tagId && ObjectId.isValid(post.tagId)) {
                const db = ctx.kernel.getDB()
                await db.collection('tags').updateOne(
                    { _id: new ObjectId(post.tagId) },
                    { $inc: { postCount: -1 } }
                )
            }
        })

        const server = ctx.kernel.getServer()
        setupTagRoutes(server, ctx.kernel)
    },

    async activate() {},
    async deactivate() {}
}

export default tagPlugin
