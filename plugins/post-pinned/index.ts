import type { Plugin } from '../../src/types.js'
import { setupPostPinnedRoutes } from './routes.js'

const POST_PINNED_MAGIC = 100
const PRIV_POST_PIN = POST_PINNED_MAGIC + 0
const PRIV_POST_UNPIN = POST_PINNED_MAGIC + 1

const postPinnedPlugin: Plugin = {
  name: 'post-pinned',
  version: '0.1.0',
  deps: ['post'],

  async init(ctx) {
    ctx.registerPriv('PRIV_POST_PIN', String(PRIV_POST_PIN))
    ctx.registerPriv('PRIV_POST_UNPIN', String(PRIV_POST_UNPIN))

    const server = ctx.kernel.getServer()
    setupPostPinnedRoutes(server, ctx.kernel)
  },

  async activate() {
    // console.log('Post Pinned plugin activated')
  },

  async deactivate() {
    // console.log('Post Pinned plugin deactivated')
  }
}

export default postPinnedPlugin