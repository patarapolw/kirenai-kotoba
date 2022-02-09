import {
  Ref,
  Severity,
  getModelForClass,
  modelOptions,
  mongoose,
  prop
} from '@typegoose/typegoose'
import S from 'jsonschema-definer'

import { IDictMeaning, sDictMeaning } from './types'

@modelOptions({ options: { allowMixed: Severity.ALLOW } })
class Dict {
  @prop() _id!: string
  @prop({ index: true }) frequency?: number
  @prop({
    default: [],
    validate: (v: any) => S.list(sDictMeaning).validate(v)[0]
  })
  meaning!: IDictMeaning[]
}

export const DictModel = getModelForClass(Dict, {
  schemaOptions: { timestamps: true, collection: 'Dict' }
})

class DictElement {
  @prop({
    index: true,
    required: true,
    ref: () => Dict,
    type: String
  })
  dict!: Ref<Dict, string>

  @prop({ index: true, required: true }) value!: string
  @prop({ index: true }) length?: number
  @prop({ index: true }) isKanji?: boolean
  @prop({ index: true }) primary?: boolean
}

export const DictElementModel = getModelForClass(DictElement, {
  schemaOptions: { collection: 'DictElement' }
})

export async function mongooseConnect(uri = process.env['MONGO_URI']!) {
  return mongoose.connect(uri)
}
