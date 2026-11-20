import { Static, Type } from "@sinclair/typebox"

export const DateTimeSchema = Type.String({ format: 'date-time' })

export const PostSchema = Type.Object({
    title: Type.String(),
    content: Type.String(),
    authorId: Type.Number(),
    visibility: Type.Number(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    tagId: Type.Optional(Type.String()),
    pinned: Type.Optional(Type.Boolean()),
    pinnedAt: Type.Optional(DateTimeSchema),
    commentCount: Type.Optional(Type.Number()),
})

export type Post = Static<typeof PostSchema>

export const CommentSchema = Type.Object({
    postId: Type.String(),
    content: Type.String(),
    authorId: Type.Number(),
    visibility: Type.Optional(Type.Number()),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    parentId: Type.Optional(Type.String()),
    replyToId: Type.Optional(Type.String()),
    deleted: Type.Optional(Type.Boolean()),
    deletedAt: Type.Optional(DateTimeSchema),
    editedAt: Type.Optional(DateTimeSchema),
});

export type Comment = Static<typeof CommentSchema>;

export const CommentCreateSchema = Type.Object({
    postId: Type.String(),
    content: Type.String({ minLength: 1, maxLength: 20000 }),
    visibility: Type.Optional(Type.Number()),
    parentId: Type.Optional(Type.String())
});

export type CommentCreate = Static<typeof CommentCreateSchema>;

export const CommentUpdateSchema = Type.Object({
    content: Type.String({ minLength: 1, maxLength: 20000 }),
    visibility: Type.Optional(Type.Number())
});

export type CommentUpdate = Static<typeof CommentUpdateSchema>;
