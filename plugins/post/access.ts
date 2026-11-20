export const VISIBILITY_PUBLIC = 0
export const VISIBILITY_HIDDEN = 2

export interface PostVisibility {
    authorId?: number
    visibility?: number | null
}

/**
 * 判断某位访问者能否看到一篇帖子。
 * 管理员（拥有 post:view_all）能看到全部；作者始终能看到自己的帖子；
 * 其余访问者只能看到公开（或未设置可见性）的帖子。
 */
export function canViewPost(post: PostVisibility | null | undefined, userId: number, canViewAll: boolean): boolean {
    if (!post) return false
    if (canViewAll) return true
    if (post.authorId === userId) return true
    return post.visibility === undefined || post.visibility === null || post.visibility === VISIBILITY_PUBLIC
}

/**
 * 生成“当前访问者可见帖子”的 Mongo 查询条件。
 */
export function buildVisibilityFilter(userId: number, canViewAll: boolean): Record<string, unknown> {
    if (canViewAll) return {}
    return {
        $or: [
            { visibility: VISIBILITY_PUBLIC },
            { visibility: { $exists: false } },
            { visibility: null },
            { authorId: userId }
        ]
    }
}
