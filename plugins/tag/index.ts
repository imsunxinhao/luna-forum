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

        ctx.registerHook('post:afterCreate', async (...args: unknown[]) => {
            const post = args[0] as Post
            if (post.tagId) {
                const db = ctx.kernel.getDB()
                await db.collection('tags').updateOne(
                    { _id: new ObjectId(post.tagId) },
                    { $inc: { postCount: 1 } }
                )
            }
        })

        ctx.registerHook('post:afterDelete', async (...args: unknown[]) => {
            const post = args[0] as Post
            if (post && post.tagId) {
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