import type { Plugin } from '../../src/types.js'
import { setupPostRoutes } from './routes.js'

const POST_MAGIC = 2
const PRIV_POST_CREATE = POST_MAGIC + 0
const PRIV_POST_EDIT = POST_MAGIC + 1
const PRIV_POST_DELETE = POST_MAGIC + 2
const PRIV_POST_VIEW = POST_MAGIC + 3
const PRIV_VIEW_ALL_POST = POST_MAGIC + 4

const postPlugin: Plugin = {
    name: 'post',
    version: '0.1.0',
    deps: [],

    async init(ctx) {
        ctx.registerPriv('view', ['guest', 'default'])
        ctx.registerPriv('create', ['default'])
        ctx.registerPriv('edit_own', ['default'])
        ctx.registerPriv('delete_own', ['default'])
        ctx.registerPriv('edit_all', ['superuser'])

        const db = ctx.kernel.getDB()

        const guest = await db
            .collection('users')
            .findOne({ uid: 0 })
        const guestPriv = BigInt(guest ? String(guest.priv) : '0')

        const viewPriv = guestPriv | (1n << BigInt(PRIV_POST_VIEW))

        await db
            .collection('users')
            .updateOne({ uid: 0 }, { $set: { priv: viewPriv.toString() } })

        const server = ctx.kernel.getServer()

        setupPostRoutes(server, ctx.kernel)
    },

    async activate() { },
    async deactivate() { }
}
export default postPlugin