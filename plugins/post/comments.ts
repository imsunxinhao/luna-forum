import { Db, Document, Filter, ObjectId } from 'mongodb'

export interface CommentAuthor {
    uid: number
    username: string
    avatar?: string
}

export interface CommentView {
    id: string
    postId: string
    content: string
    authorId: number
    author: CommentAuthor | null
    createdAt: string
    updatedAt?: string
    editedAt?: string
    parentId?: string
    replyToId?: string
    replyToUsername?: string
    deleted: boolean
    canEdit: boolean
    canDelete: boolean
    replies?: CommentView[]
}

export interface CommentPage {
    comments: CommentView[]
    /** 当前页根评论数量（用于分页）。 */
    total: number
    /** 帖子下未被删除的评论总数（含回复，用于展示计数）。 */
    totalComments: number
    page: number
    limit: number
    totalPages: number
}

export interface CommentPermissions {
    viewerId?: number
    canEditOwn?: boolean
    canDeleteOwn?: boolean
    canEditAll?: boolean
    canDeleteAll?: boolean
}

export interface ListCommentsOptions extends CommentPermissions {
    page?: number
    limit?: number
}

export interface CommentDoc extends Document {
    _id: ObjectId
    postId: string
    authorId: number
    content?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    editedAt?: Date | string
    parentId?: string | null
    replyToId?: string
    deleted?: boolean
}

function toIso(value: Date | string | undefined): string {
    if (!value) return ''
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

export async function loadCommentAuthors(db: Db, ids: number[]): Promise<Map<number, CommentAuthor>> {
    const unique = [...new Set(ids.filter(id => Number.isFinite(id)))]
    const authors = new Map<number, CommentAuthor>()
    if (unique.length === 0) return authors
    const users = await db.collection('users').find(
        { uid: { $in: unique } },
        { projection: { uid: 1, username: 1, avatar: 1, _id: 0 } }
    ).toArray()
    for (const user of users) {
        const uid = Number(user.uid)
        authors.set(uid, {
            uid,
            username: String(user.username ?? ''),
            avatar: typeof user.avatar === 'string' ? user.avatar : undefined
        })
    }
    return authors
}

function canModify(comment: CommentDoc, permissions: CommentPermissions, kind: 'edit' | 'delete'): boolean {
    if (comment.deleted) return false
    const isOwner = comment.authorId === permissions.viewerId
    if (kind === 'edit') {
        return isOwner ? permissions.canEditOwn === true : permissions.canEditAll === true
    }
    return isOwner ? permissions.canDeleteOwn === true : permissions.canDeleteAll === true
}

function toView(
    comment: CommentDoc,
    authors: Map<number, CommentAuthor>,
    byId: Map<string, CommentDoc>,
    permissions: CommentPermissions
): CommentView {
    const id = comment._id.toString()
    const deleted = comment.deleted === true
    const author = deleted ? null : authors.get(comment.authorId) ?? null
    const target = comment.replyToId ? byId.get(comment.replyToId) : undefined
    const targetAuthor = target && !target.deleted ? authors.get(target.authorId) : undefined
    return {
        id,
        postId: comment.postId,
        content: deleted ? '' : String(comment.content ?? ''),
        authorId: comment.authorId,
        author,
        createdAt: toIso(comment.createdAt),
        updatedAt: toIso(comment.updatedAt) || undefined,
        editedAt: toIso(comment.editedAt) || undefined,
        parentId: typeof comment.parentId === 'string' ? comment.parentId : undefined,
        replyToId: comment.replyToId,
        replyToUsername: targetAuthor?.username,
        deleted,
        canEdit: canModify(comment, permissions, 'edit'),
        canDelete: canModify(comment, permissions, 'delete')
    }
}

/**
 * 读取一篇帖子的评论，并按“根评论 -> 回复”的两层结构返回。
 * 回复只挂在一层根评论下；回复的回复会记录 replyToId，用于展示“回复 @某人”。
 */
export async function buildCommentTree(db: Db, postId: string, options: ListCommentsOptions = {}): Promise<CommentPage> {
    const requestedPage = Math.max(1, Math.floor(options.page ?? 1))
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50)))
    const collection = db.collection<CommentDoc>('comments')
    const rootFilter: Filter<CommentDoc> = { postId, parentId: null }

    const [total, totalComments] = await Promise.all([
        collection.countDocuments(rootFilter),
        collection.countDocuments({ postId, deleted: { $ne: true } })
    ])
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const page = Math.min(requestedPage, totalPages)
    const skip = (page - 1) * limit
    const roots = await collection
        .find(rootFilter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .toArray()

    const rootIds = roots.map(root => root._id.toString())
    const replies = rootIds.length === 0
        ? []
        : await collection
            .find({ postId, parentId: { $in: rootIds } })
            .sort({ createdAt: 1, _id: 1 })
            .toArray()

    const all = [...roots, ...replies]
    const authors = await loadCommentAuthors(db, all.map(comment => comment.authorId))
    const byId = new Map(all.map(comment => [comment._id.toString(), comment]))

    const repliesByParent = new Map<string, CommentView[]>()
    for (const reply of replies) {
        const parentId = typeof reply.parentId === 'string' ? reply.parentId : ''
        const list = repliesByParent.get(parentId) ?? []
        list.push(toView(reply, authors, byId, options))
        repliesByParent.set(parentId, list)
    }

    const views = roots.map(root => {
        const view = toView(root, authors, byId, options)
        view.replies = repliesByParent.get(view.id) ?? []
        return view
    })

    return {
        comments: views,
        total,
        totalComments,
        page,
        limit,
        totalPages
    }
}

/** 单条评论的展示结构，用于创建/编辑接口的响应。 */
export async function getCommentView(db: Db, comment: CommentDoc, permissions: CommentPermissions = {}): Promise<CommentView> {
    const ids = [comment.authorId]
    let target: CommentDoc | null = null
    if (comment.replyToId && ObjectId.isValid(comment.replyToId)) {
        target = await db.collection<CommentDoc>('comments').findOne({ _id: new ObjectId(comment.replyToId) })
        if (target) ids.push(target.authorId)
    }
    const authors = await loadCommentAuthors(db, ids)
    const byId = new Map<string, CommentDoc>([[comment._id.toString(), comment]])
    if (target) byId.set(target._id.toString(), target)
    return toView(comment, authors, byId, permissions)
}

/** 重新统计并写回帖子的评论数（软删除的评论不计入）。 */
export async function syncCommentCount(db: Db, postId: string): Promise<number> {
    const count = await db.collection('comments').countDocuments({ postId, deleted: { $ne: true } })
    if (ObjectId.isValid(postId)) {
        await db.collection('posts').updateOne(
            { _id: new ObjectId(postId) },
            { $set: { commentCount: count } }
        )
    }
    return count
}