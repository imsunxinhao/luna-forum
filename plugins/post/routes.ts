import { ObjectId } from 'mongodb';
const POST_MAGIC = 2;
const PRIV_POST_CREATE = POST_MAGIC + 0;
const PRIV_POST_EDIT = POST_MAGIC + 1;
const PRIV_POST_DELETE = POST_MAGIC + 2;
const PRIV_POST_VIEW = POST_MAGIC + 3;
const PRIV_VIEW_ALL_POST = POST_MAGIC + 4;
const VISIBILITY_PUBLIC = 0;
const VISIBILITY_PRIVATE = 1;
const VISIBILITY_HIDDEN = 2;
async function canViewPost(db: any, post: any, userId: number, kernel: any): Promise<boolean> {
  if (!post) return false;
  if (await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST)) return true;
  if (post.authorId === userId) return true;
  if (post.visibility === VISIBILITY_PUBLIC || post.visibility === undefined) return true;
  return false;
}
function buildVisibilityFilter(userId: number, canView: boolean): any {
  if (canView) return {};
  return {
    $or: [
      { visibility: VISIBILITY_PUBLIC },
      { visibility: { $exists: false } },
      { authorId: userId }
    ]
  };
}
export function setupPostRoutes(server: any, kernel: any): void {
  server.get('/api/v1/post/list', async (request: any, reply: any) => {
    const userId = kernel.getUserIdFromRequest(request);
    const { page = 1, limit = 20, tagId } = request.query;
    const canView = await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST);
    const db = kernel.getDB();
    const filter: any = buildVisibilityFilter(userId, canView);
    if (tagId) filter.tagId = tagId;
    await kernel.callHook('post:beforeList', { userId, page, limit, filter });
    const skip = (Number(page) - 1) * Number(limit);
    const posts = await db.collection('posts')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .toArray();
    const total = await db.collection('posts').countDocuments(filter);
    const enriched = await kernel.callHook('post:afterList', { posts, total, page: Number(page), limit: Number(limit), userId });
    let result = { posts, total, page: Number(page), limit: Number(limit) };
    for (const e of enriched) {
      if (e && typeof e === 'object') result = { ...result, ...e };
    }
    return { success: true, ...result };
  });
  server.get('/api/v1/post/:id', async (request: any, reply: any) => {
    const userId = kernel.getUserIdFromRequest(request);
    const { id } = request.params;
    await kernel.callHook('post:beforeView', { id, userId });
    const db = kernel.getDB();
    const post = await db.collection('posts').findOne({ _id: new ObjectId(id) });
    if (!post) {
      return reply.code(404).send({ success: false, error: 'Post not found' });
    }
    if (!(await canViewPost(db, post, userId, kernel))) {
      return reply.code(403).send({ success: false, error: 'No permission to view post' });
    }
    const enriched = await kernel.callHook('post:afterView', { post, userId });
    let result = { post };
    for (const e of enriched) {
      if (e && typeof e === 'object') result = { ...result, ...e };
    }
    return { success: true, ...result };
  });
  server.post('/api/v1/post/create', async (request: any, reply: any) => {
    const { title, content, tagId, visibility } = request.body;
    const userId = kernel.getUserIdFromRequest(request);
    const canCreate = await kernel.hasPriv(userId, PRIV_POST_CREATE);
    if (!canCreate) {
      return reply.code(403).send({ success: false, error: 'No permission to create post' });
    }
    if (visibility === VISIBILITY_HIDDEN && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))) {
      return reply.code(403).send({ success: false, error: 'Cannot create hidden post' });
    }
    const db = kernel.getDB();
    const finalVisibility = (visibility === VISIBILITY_HIDDEN && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST)))
      ? VISIBILITY_PUBLIC
      : (visibility ?? VISIBILITY_PUBLIC);
    const post: any = {
      title,
      content,
      authorId: userId,
      visibility: finalVisibility,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    if (tagId) {
      const tag = await db.collection('tags').findOne({ _id: new ObjectId(tagId) });
      if (tag) post.tagId = tagId;
    }
    const modified = await kernel.callHook('post:beforeCreate', post);
    let finalPost = post;
    for (const e of modified) {
      if (e && typeof e === 'object') finalPost = { ...finalPost, ...e };
    }
    const result = await db.collection('posts').insertOne(finalPost);
    const newPost = { ...finalPost, _id: result.insertedId };
    const enriched = await kernel.callHook('post:afterCreate', newPost);
    let finalResult = newPost;
    for (const e of enriched) {
      if (e && typeof e === 'object') finalResult = { ...finalResult, ...e };
    }
    return reply.code(201).send({ success: true, post: finalResult });
  });
  server.put('/api/v1/post/:id', async (request: any, reply: any) => {
    const { id } = request.params;
    const { title, content, visibility } = request.body;
    const userId = kernel.getUserIdFromRequest(request);
    const db = kernel.getDB();
    const oldPost = await db.collection('posts').findOne({ _id: new ObjectId(id) });
    if (!oldPost) {
      return reply.code(404).send({ success: false, error: 'Post not found' });
    }
    if (oldPost.authorId !== userId && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))) {
      return reply.code(403).send({ success: false, error: 'No permission to edit this post' });
    }
    const isAdmin = await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST);
    if (visibility !== undefined && !isAdmin && visibility === VISIBILITY_HIDDEN) {
      return reply.code(403).send({ success: false, error: 'Cannot set post to hidden' });
    }
    await kernel.callHook('post:beforeEdit', { id, title, content, visibility, userId, oldPost });
    const update: any = { updatedAt: new Date() };
    if (title !== undefined) update.title = title;
    if (content !== undefined) update.content = content;
    if (visibility !== undefined) update.visibility = visibility;
    if (content !== undefined && content !== oldPost.content) {
      await db.collection('post_edits').insertOne({
        postId: id,
        oldContent: oldPost.content,
        newContent: content,
        editedBy: userId,
        editedAt: new Date()
      });
    }
    const result = await db.collection('posts').updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );
    if (result.modifiedCount === 0) {
      return reply.code(404).send({ success: false, error: 'Post not found or not authorized' });
    }
    await kernel.callHook('post:afterEdit', { id, title, content, visibility, userId });
    return { success: true, modified: true };
  });
  server.get('/api/v1/post/:id/edits', async (request: any, reply: any) => {
    const { id } = request.params;
    const userId = kernel.getUserIdFromRequest(request);
    const db = kernel.getDB();
    const post = await db.collection('posts').findOne({ _id: new ObjectId(id) });
    if (!post) {
      return reply.code(404).send({ success: false, error: 'Post not found' });
    }
    if (!(await canViewPost(db, post, userId, kernel))) {
      return reply.code(403).send({ success: false, error: 'No permission to view post' });
    }
    const edits = await db.collection('post_edits')
      .find({ postId: id })
      .sort({ editedAt: -1 })
      .toArray();
    return { success: true, edits };
  });
  server.delete('/api/v1/post/:id', async (request: any, reply: any) => {
    const { id } = request.params;
    const userId = kernel.getUserIdFromRequest(request);
    const db = kernel.getDB();
    const post = await db.collection('posts').findOne({ _id: new ObjectId(id) });
    if (!post) {
      return reply.code(404).send({ success: false, error: 'Post not found' });
    }
    if (post.authorId !== userId && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))) {
      return reply.code(403).send({ success: false, error: 'No permission to delete this post' });
    }
    await kernel.callHook('post:beforeDelete', post);
    const result = await db.collection('posts').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return reply.code(404).send({ success: false, error: 'Post not found' });
    }
    await kernel.callHook('post:afterDelete', post);
    return { success: true, deleted: true };
  });
}