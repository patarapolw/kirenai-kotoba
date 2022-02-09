import S from 'jsonschema-definer'

export const sDictMeaning = S.shape({
  pos: S.string().optional(),
  xref: S.list(S.string()).minItems(1).optional(),
  gloss: S.list(S.string())
})

export type IDictMeaning = typeof sDictMeaning.type
