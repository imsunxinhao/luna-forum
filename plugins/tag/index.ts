import type { Plugin } from '../../src/types.js'
import { setupTagRoutes } from './routes.js'

const TAG_MAGIC = 500
const PRIV_TAG_CREATE = TAG_MAGIC + 0
const PRIV_TAG_EDIT = TAG_MAGIC + 1
const PRIV_TAG_DELETE = TAG_MAGIC + 2
const PRIV_TAG_MOD = TAG_MAGIC + 3

const tagPlugin: Plugin = {
  name: 'tag',
  version: '0.1.0',
  deps: [],

  async init(ctx) {
    ctx.registerPriv('PRIV_TAG_CREATE', String(PRIV_TAG_CREATE))
    ctx.registerPriv('PRIV_TAG_EDIT', String(PRIV_TAG_EDIT))
    ctx.registerPriv('PRIV_TAG_DELETE', String(PRIV_TAG_DELETE))
    ctx.registerPriv('PRIV_TAG_MOD', String(PRIV_TAG_MOD))

    ctx.registerHook('post:afterCreate', async (post) => {
      if (post.tagId) {
        const db = ctx.kernel.getDB()
        await db.collection('tags').updateOne(
          { _id: post.tagId },
          { $inc: { postCount: 1 } }
        )
      }
    })

    ctx.registerHook('post:afterDelete', async (post) => {
      if (post && post.tagId) {
        const db = ctx.kernel.getDB()
        await db.collection('tags').updateOne(
          { _id: post.tagId },
          { $inc: { postCount: -1 } }
        )
      }
    })

    const server = ctx.kernel.getServer()
    setupTagRoutes(server, ctx.kernel)
  },

  async activate() {
    // console.log('Tag plugin activated')
  },

  async deactivate() {
    // console.log('Tag plugin deactivated')
  }
}

export default tagPlugin