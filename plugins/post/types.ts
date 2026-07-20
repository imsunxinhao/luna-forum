import { Static, Type } from "@sinclair/typebox"

export const DateTimeSchema = Type.String({ format: 'date-time' })

export const PostSchema = Type.Object({
  title: Type.String(),
  content: Type.String(),
  authorId: Type.Number(),
  visibility: Type.Number(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  tagId: Type.Optional(Type.Number()),
})

export type Post = Static<typeof PostSchema>