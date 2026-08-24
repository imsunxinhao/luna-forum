import type { KernelAPI } from '../../src/types.js'

const VISIBILITY_PUBLIC = 0

function buildVisibilityFilter(userId: number) {
    return {
        $or: [
            { visibility: VISIBILITY_PUBLIC },
            { visibility: { $exists: false } },
            { authorId: userId }
        ]
    }
}

export function formatRelativeTime(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(date.getTime())) return ''
    const diff = Date.now() - date.getTime()
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return '刚刚'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} 分钟前`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} 小时前`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days} 天前`
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

export async function getHomePosts(kernel: KernelAPI, userId: number) {
    const db = kernel.getDB()
    const visibilityFilter = buildVisibilityFilter(userId)

    const [posts, tags, postCount] = await Promise.all([
        db.collection('posts').find(visibilityFilter).sort({ createdAt: -1 }).limit(20).toArray(),
        db.collection('tags').find().toArray(),
        db.collection('posts').countDocuments(visibilityFilter)
    ])

    const tagMap = new Map<string, { name?: string }>()
    for (const tag of tags) {
        tagMap.set(String(tag._id), tag as { name?: string })
    }

    const authorIds = Array.from(new Set(
        posts.map((post) => post.authorId).filter((id): id is number => typeof id === 'number')
    ))

    const authors = authorIds.length
        ? await db.collection('users').find({ uid: { $in: authorIds } }).toArray()
        : []

    const authorMap = new Map<number, { username?: string }>()
    for (const user of authors) {
        authorMap.set(user.uid as number, user as { username?: string })
    }

    const enrichedPosts = posts.map((post) => {
        const author = post.authorId != null ? authorMap.get(post.authorId as number) : undefined
        const authorName = author?.username ?? '未知用户'
        const tagName = post.tagId ? tagMap.get(String(post.tagId))?.name : undefined
        return {
            ...post,
            id: String(post._id),
            authorName,
            authorInitial: authorName ? authorName[0] : '?',
            tagName,
            createdAtLabel: formatRelativeTime(post.createdAt),
            createdAtISO: post.createdAt instanceof Date ? post.createdAt.toISOString() : String(post.createdAt ?? '')
        }
    })

    return { posts: enrichedPosts, postCount }
}
