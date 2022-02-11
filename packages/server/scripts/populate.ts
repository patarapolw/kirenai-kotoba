import fs from 'fs'

import { DictElementModel, DictModel, mongooseConnect } from '@/db/mongo'
import { IDictMeaning } from '@/db/types'
import axios from 'axios'
import cheerio from 'cheerio'
import flow, { toXml } from 'xml-flow'

interface IEntryValue {
  value: string
  isKanji?: boolean
  length?: number
  primary?: boolean
}

async function main() {
  const xmlFlow = flow(fs.createReadStream('../scripts/cache/JMdict_e.xml'))

  const batchSize = 1000
  const entries: {
    _id: string
    slug: string
    values: IEntryValue[]
    frequency?: number
    meaning: IDictMeaning[]
  }[] = []

  xmlFlow.on('tag:entry', (ent) => {
    const xml = toXml(ent)
    const $ = cheerio.load(xml)

    const _id = $('ent_seq').text()
    const values: IEntryValue[] = []

    $('k_ele').each((_, k_ele) => {
      const $k_ele = $(k_ele)

      let value = $k_ele.find('keb').text()
      let primary = false

      if (value) {
        primary = !!$k_ele.find('ke_pri').length
      } else {
        value = $k_ele.text().trim()
        if (!value || /[a-z]/i.test(value)) return
      }

      const v: IEntryValue = {
        value,
        isKanji: true
      }

      if (primary) {
        v.primary = true
      }

      values.push(v)
    })

    $('r_ele').each((_, r_ele) => {
      const $r_ele = $(r_ele)

      let value = $r_ele.find('reb').text()
      let primary = !!$r_ele.find('re_pri').length
      if (value) {
        primary = !!$r_ele.find('re_pri').length
      } else {
        value = $r_ele.text().trim()
        if (!value || /[a-z]/i.test(value)) return
      }

      const v: IEntryValue = {
        value
      }

      if (primary) {
        v.primary = true
        v.length = value.length
      }

      values.push(v)
    })

    if (!values.length) return

    const meaning: IDictMeaning[] = []

    $('sense').each((_, sense) => {
      const $sense = $(sense)
      const m: IDictMeaning = {
        gloss: Array.from($sense.find('gloss')).map((g) => $(g).text())
      }

      const pos = $sense.find('pos').text()
      if (pos.length) {
        m.pos = pos
      }

      const xref = Array.from($sense.find('xref')).map((g) => $(g).text())
      if (xref.length) {
        m.xref = xref
      }

      meaning.push(m)
    })

    entries.push({
      _id,
      slug: (values.filter((v) => v.primary)[0] || values[0])!.value,
      values,
      meaning
    })
  })

  const conn = await mongooseConnect()

  for (let i = 0; i < entries.length; i += batchSize) {
    const map = new Map<string, typeof entries>()
    entries.slice(i, i + batchSize).map((it) => {
      const vs = map.get(it.slug) || []
      vs.push(it)
      map.set(it.slug, vs)
    })

    await axios
      .post<Record<string, number>>(
        `https://cdn.zhquiz.cc/api/wordfreq?lang=ja`,
        {
          q: [
            ...new Set(
              Array.from(map.values()).flatMap((vs) => vs.map((v) => v.slug))
            )
          ]
        }
      )
      .then(({ data }) => {
        Object.entries(data).map(([slug, f]) => {
          const vs = (map.get(slug) || []).map((v) => {
            v.frequency = f
            return v
          })
          map.set(slug, vs)
        })
      })

    const currentEntries = Array.from(map.values()).flat()

    await DictModel.insertMany(
      currentEntries.map((it) => ({
        _id: it._id,
        frequency: it.frequency,
        meaning: it.meaning
      }))
    )

    await DictElementModel.insertMany(
      currentEntries.flatMap((it) =>
        it.values.map((v) => ({
          ...v,
          dict: it._id
        }))
      )
    )
  }

  await conn.disconnect()
}

if (require.main === module) {
  main()
}
