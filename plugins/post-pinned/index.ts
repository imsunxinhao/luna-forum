import type { Plugin } from '../../src/types.js'
import { setupPostPinnedRoutes } from './routes.js'

const postPinnedPlugin: Plugin = {
    name: 'post-pinned',
    version: '0.1.0',
    deps: ['post'],

    async init(ctx) {
        ctx.registerPriv('pin', ['superuser'])
        ctx.registerPriv('unpin', ['superuser'])

        const server = ctx.kernel.getServer()
        setupPostPinnedRoutes(server, ctx.kernel)
    },

    async activate() { },
    async deactivate() { }
}

export default postPinnedPlugin