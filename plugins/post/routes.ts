import { Db, ObjectId } from 'mongodb';
import { KernelAPI } from '../../src/types';
import { Post, PostSchema } from './types';
import { Static, StaticDecode, Type } from '@sinclair/typebox'
import { FastifyInstance } from 'fastify';
import { ErrorBase as ErrorBaseType, ErrorBaseSchema } from '../../src/schema';

const POST_MAGIC = 2;
const PRIV_POST_CREATE = POST_MAGIC + 0;
const PRIV_POST_EDIT = POST_MAGIC + 1;
const PRIV_POST_DELETE = POST_MAGIC + 2;
const PRIV_POST_VIEW = POST_MAGIC + 3;
const PRIV_VIEW_ALL_POST = POST_MAGIC + 4;
const VISIBILITY_PUBLIC = 0;
const VISIBILITY_PRIVATE = 1;
const VISIBILITY_HIDDEN = 2;

async function canViewPost(db: Db, post: Post, userId: number, kernel: KernelAPI) {
  if (!post) return false;

  if (await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST)) return true;

  if (post.authorId === userId) return true;

  if (post.visibility === VISIBILITY_PUBLIC || post.visibility === undefined) return true;

  return false;
}

function buildVisibilityFilter(userId: number, canView: boolean) {
  if (canView) return {};

  return {
    $or: [
      { visibility: VISIBILITY_PUBLIC },
      { visibility: { $exists: false } },
      { authorId: userId }
    ]
  };
}

export function setupPostRoutes(server: FastifyInstance, kernel: KernelAPI) {
  const listQuerySchema = Type.Object({
    page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
    limit: Type.Optional(Type.Number({ minimum: 1, default: 20 })),
    tagId: Type.Optional(Type.Number())
  })
  const listReplySchema = Type.Object({
    posts: Type.Array(PostSchema)
  })
  server.get<{
    Querystring: Static<typeof listQuerySchema>,
    Reply: Post
  }>('/api/v1/post/list', {
      schema: {
        querystring: listQuerySchema,
        response: {
          200: listReplySchema
        }
      }
    },
    async (request, reply) => {
      const userId = kernel.getUserIdFromRequest(request);

      const { page = 1, limit = 20, tagId } = request.query;

      const canView = await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST);

      const db = kernel.getDB();

      let filter: Record<string, unknown> = buildVisibilityFilter(userId, canView); // TODO: use type

      if (tagId) filter =  { ...filter, tagId };

      await kernel.callHook('post:beforeList', { userId, page, limit, filter });

      const skip = (page - 1) * limit;

      const posts = await db.collection('posts')
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const total = await db
        .collection('posts')
        .countDocuments(filter);

      const enriched = await kernel.callHook('post:afterList', {
        posts,
        total,
        page,
        limit,
        userId
      });
      
      let result = {
        posts: [], // TODO: Masked
        total,
      };

      for (const e of enriched) {
        if (e && typeof e === 'object')
          result = { ...result, ...e };
      }

      //return result;
    }
  );

  const getParamSchema = Type.Object({id: Type.Number()})
  const getReplySchema = Type.Object({
    post: PostSchema
  })
  server.get<{
    Params: Static<typeof getParamSchema>,
    Reply: StaticDecode<typeof getReplySchema> | ErrorBaseType
  }>('/api/v1/post/:id', {
    schema: {
      params: getParamSchema,
      response: {
        200: getReplySchema,
        404: ErrorBaseSchema,
        403: ErrorBaseSchema
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;

    const userId = kernel.getUserIdFromRequest(request);

    const db = kernel.getDB();

    await kernel.callHook('post:beforeView', { id, userId });

    const post = await db
      .collection('posts')
      .findOne({
        _id: new ObjectId(id.toString())
      }) as Post | null;

    if (!post) {
      return reply.code(404).send({
        message: 'Post not found'
      }
    );
    }
    
    if (!(await canViewPost(db, post, userId, kernel))) {
      return reply.code(403).send({
        message: 'No permission to view post'
      });
    }

    const enriched = await kernel.callHook('post:afterView', { post, userId });
    
    let result = { post };
    
    for (const e of enriched) {
      if (e && typeof e === 'object') result = { ...result, ...e };
    }
    
    return result;
  });

  const createBodySchema = Type.Object({
    title: Type.String(),
    content: Type.String(),
    tagId: Type.Optional(Type.Number()),
    visibility: Type.Optional(Type.Number())
  })
  server.post<{
    Body: Static<typeof createBodySchema>
  }>('/api/v1/post/create',{
    schema: {
      body: createBodySchema
    }
  }, async (request, reply) => {
    const { title, content, tagId, visibility } = request.body;
  
    const userId = kernel.getUserIdFromRequest(request);
  
    const canCreate = await kernel.hasPriv(userId, PRIV_POST_CREATE);

    const db = kernel.getDB()
  
    if (!canCreate) {
      return reply.code(403).send({ success: false, error: 'No permission to create post' });
    }
  
    if (visibility === VISIBILITY_HIDDEN && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))) {
      return reply.code(403).send({ success: false, error: 'Cannot create hidden post' });
    }
  
    const finalVisibility = (
      visibility === VISIBILITY_HIDDEN
      && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))
    )
    ? VISIBILITY_PUBLIC
    : visibility ?? VISIBILITY_PUBLIC;

    const post: Post = {
      title,
      content,
      authorId: userId,
      visibility: finalVisibility,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (tagId) {
      const tag = await db
        .collection('tags')
        .findOne({ _id: new ObjectId(tagId.toString()) });

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
    return reply.code(201).send({ post: finalResult });
  });

  const replaceParamsSchema = Type.Object({
    id: Type.Number()
  })
  server.put<{
    Body: Post,
    Params: Static<typeof replaceParamsSchema>
  }>('/api/v1/post/:id', {
    schema: {
      body: PostSchema,
      params: replaceParamsSchema
    }
  }, async (request, reply) => {
    const { id } = request.params;
    
    const { title, content, visibility } = request.body;
    
    const userId = kernel.getUserIdFromRequest(request);
    
    const db = kernel.getDB();
    
    const oldPost = await db
      .collection('posts')
      .findOne({ _id: new ObjectId(id.toString()) });
    
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
    
    const update: Partial<Post> = { updatedAt: new Date().toISOString() };
    
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
      { _id: new ObjectId(id.toString()) },
      { $set: update }
    );
    
    if (result.modifiedCount === 0) {
      return reply.code(404).send({ success: false, error: 'Post not found or not authorized' });
    }
    
    await kernel.callHook('post:afterEdit', { id, title, content, visibility, userId });
    
    return { success: true, modified: true };
  });

  const getEditsParamsSchema = Type.Object({
    id: Type.Number()
  })
  server.get<{
    Params: Static<typeof getEditsParamsSchema>
  }>('/api/v1/post/:id/edits', {
    schema: {
      params: getEditsParamsSchema
    }
  }, async (request, reply) => {
    const { id } = request.params;
    
    const userId = kernel.getUserIdFromRequest(request);
    
    const db = kernel.getDB();
    
    const post = await db
      .collection('posts')
      .findOne({ _id: new ObjectId(id.toString()) }) as Post | null;
    
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

  const deleteParamsSchema = Type.Object({
    id: Type.Number()
  })
  server.delete<{
    Params: Static<typeof deleteParamsSchema>,
    Reply: undefined
  }>('/api/v1/post/:id', {
    schema: {
      params: deleteParamsSchema,
      response: {
        204: Type.Object({})
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;

    const userId = kernel.getUserIdFromRequest(request);
    
    const db = kernel.getDB();
    
    const post = await db
      .collection('posts')
      .findOne({ _id: new ObjectId(id.toString()) });
    
      if (!post) {
      return reply.code(404).send({ success: false, error: 'Post not found' });
    }
    
    if (post.authorId !== userId && !(await kernel.hasPriv(userId, PRIV_VIEW_ALL_POST))) {
      return reply.code(403).send({ success: false, error: 'No permission to delete this post' });
    }
    
    await kernel.callHook('post:beforeDelete', post);
    
    const result = await db.collection('posts').deleteOne({ _id: new ObjectId(id.toString()) });
    
    if (result.deletedCount === 0) {
      return reply.code(404).send({ success: false, error: 'Post not found' });
    }
    
    await kernel.callHook('post:afterDelete', post);
    
    return reply.code(204)
  });
}