import {ObjectId} from 'mongodb'
const POST_MAGIC = 2
const PRIV_POST_CREATE = POST_MAGIC + 0
const PRIV_POST_EDIT = POST_MAGIC + 1
const PRIV_POST_DELETE = POST_MAGIC + 2
const PRIV_POST_VIEW = POST_MAGIC + 3

export function setupPostRoutes(server: any, kernel: any): void {
  server.get('/api/v1/post/list', async (request: any, reply: any) => {
    const userId = kernel.getUserIdFromRequest(request)
    const { page = 1, limit = 20 } = request.query

    const canView = await kernel.hasPriv(userId, PRIV_POST_VIEW)
    if (!canView) {
      return reply.code(403).send({ success: false, error: 'No permission to view posts' })
    }

    const db = kernel.getDB()
    const skip = (Number(page) - 1) * Number(limit)
    const posts = await db.collection('posts')
      .find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .toArray()

    const total = await db.collection('posts').countDocuments()
    return { success: true, posts, total, page: Number(page), limit: Number(limit) }
  })

  server.get('/api/v1/post/:id', async (request: any, reply: any) => {
    const userId = kernel.getUserIdFromRequest(request)
    const { id } = request.params

    const canView = await kernel.hasPriv(userId, PRIV_POST_VIEW)
    if (!canView) {
      return reply.code(403).send({ success: false, error: 'No permission to view post' })
    }

    const db = kernel.getDB()
    const post = await db.collection('posts').findOne({ _id: new ObjectId(id) })
    if (!post) {
      return reply.code(404).send({ success: false, error: 'Post not found' })
    }

    return { success: true, post }
  })

  server.post('/api/v1/post/create', async (request: any, reply: any) => {
    const { title, content, tagId } = request.body
    const userId = kernel.getUserIdFromRequest(request)

    const canCreate = await kernel.hasPriv(userId, PRIV_POST_CREATE)
    if (!canCreate) {
      return reply.code(403).send({ success: false, error: 'No permission to create post' })
    }

    const db = kernel.getDB()
    const post: any = {
      title,
      content,
      authorId: userId,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    if (tagId) {
      const tag = await db.collection('tags').findOne({ _id: new ObjectId(tagId) })
      if (tag) post.tagId = tagId
    }

    await kernel.callHook('post:beforeCreate', post)
    const result = await db.collection('posts').insertOne(post)
    const newPost = { ...post, _id: result.insertedId }
    await kernel.callHook('post:afterCreate', newPost)

    return reply.code(201).send({ success: true, post: newPost })
  })

  server.put('/api/v1/post/:id', async (request: any, reply: any) => {
    const { id } = request.params
    const { title, content } = request.body
    const userId = kernel.getUserIdFromRequest(request)

    const canEdit = await kernel.hasPriv(userId, PRIV_POST_EDIT)
    if (!canEdit) {
      return reply.code(403).send({ success: false, error: 'No permission to edit post' })
    }

    const db = kernel.getDB()
    const result = await db.collection('posts').updateOne(
      { _id: new ObjectId(id), authorId: userId },
      { $set: { title, content, updatedAt: new Date() } }
    )

    if (result.modifiedCount === 0) {
      return reply.code(404).send({ success: false, error: 'Post not found or not authorized' })
    }

    return { success: true, modified: true }
  })

  server.delete('/api/v1/post/:id', async (request: any, reply: any) => {
    const { id } = request.params
    const userId = kernel.getUserIdFromRequest(request)

    const canDelete = await kernel.hasPriv(userId, PRIV_POST_DELETE)
    if (!canDelete) {
      return reply.code(403).send({ success: false, error: 'No permission to delete post' })
    }

    const db = kernel.getDB()
    const post = await db.collection('posts').findOne({ _id: new ObjectId(id) })

    await kernel.callHook('post:beforeDelete', post)

    const result = await db.collection('posts').deleteOne({ _id: new ObjectId(id), authorId: userId })
    if (result.deletedCount === 0) {
      return reply.code(404).send({ success: false, error: 'Post not found or not authorized' })
    }

    await kernel.callHook('post:afterDelete', post)
    return { success: true, deleted: true }
  })
}