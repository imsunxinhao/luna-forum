import { Static, StaticDecode, Type } from "@sinclair/typebox"

export const ErrorBaseSchema = Type.Object({
  code: Type.Optional(Type.Number()),
  message: Type.Optional(Type.String())
})

export type ErrorBase = Static<typeof ErrorBaseSchema>