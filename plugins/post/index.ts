import type { Plugin } from '../../src/types.js'
import { setupPostRoutes } from './routes.js'

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
        ctx.registerPriv('delete_all', ['superuser'])
        ctx.registerPriv('view_all', ['superuser'])

        const server = ctx.kernel.getServer()
        setupPostRoutes(server, ctx.kernel)
    },

    async activate() { },
    async deactivate() { }
}

export default postPlugin