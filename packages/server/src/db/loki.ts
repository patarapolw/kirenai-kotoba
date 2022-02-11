import { execSync } from 'child_process'
import fs from 'fs'

import axios from 'axios'
import cheerio from 'cheerio'
import Loki from 'lokijs'
import { toHiragana } from 'wanakana'
import flow, { toXml } from 'xml-flow'

import { IDict, IDictElement, IDictMeaning, reJa, simplifySmall } from './types'

export let db: Loki
export let Dict: Collection<IDict>
export let DictElement: Collection<IDictElement>

export async function initDB(
  filename = 'cache/jmdict.loki',
  jmdictXml = 'cache/JMdict_e.xml'
) {
  return new Promise<Loki>((resolve, reject) => {
    const isNew = !fs.existsSync(filename)

    db = new Loki(filename, {
      autoload: true,
      autoloadCallback: async (err) => {
        if (err) {
          reject(err)
          return
        }

        if (isNew) {
          if (!fs.existsSync(jmdictXml)) {
            execSync(
              `curl ftp://ftp.edrdg.org/pub/Nihongo//JMdict_e.gz | gunzip > ${jmdictXml}`
            )
          }

          const xmlFlow = flow(fs.createReadStream(jmdictXml))

          Dict = db.addCollection('Dict', {
            indices: ['frequency'],
            unique: ['_id']
          })

          DictElement = db.addCollection('DictElement', {
            indices: [
              'dict',
              'value',
              'length',
              'char',
              'repeat',
              'repeatx',
              'primary'
            ]
          })

          const batchSize = 1000
          const entries: (IDict & {
            slug: string
            values: IDictElement[]
          })[] = []

          xmlFlow.on('tag:entry', (ent) => {
            const xml = toXml(ent)
            const $ = cheerio.load(xml)

            const _id = $('ent_seq').text()
            const values: IDictElement[] = []

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

              const allChar = Array.from(toHiragana(value).matchAll(reJa)).map(
                (m) => m[0]!
              )
              const char = [...new Set(allChar)]
              const allCharX = simplifySmall(allChar)

              const v: IDictElement = {
                dict: _id,
                value,
                char,
                repeat: allChar.length - char.length,
                repeatx: allCharX.length - new Set(allCharX).size
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

              const allChar = Array.from(toHiragana(value).matchAll(reJa)).map(
                (m) => m[0]!
              )
              const char = [...new Set(allChar)]
              const allCharX = simplifySmall(allChar)

              const v: IDictElement = {
                dict: _id,
                value,
                char,
                repeat: allChar.length - char.length,
                repeatx: allCharX.length - new Set(allCharX).size
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

              const xref = Array.from($sense.find('xref')).map((g) =>
                $(g).text()
              )
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

          await new Promise((resolve, reject) => {
            xmlFlow.once('end', resolve).once('error', reject)
          })

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
                      Array.from(map.values()).flatMap((vs) =>
                        vs.map((v) => v.slug)
                      )
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

            Dict.insert(
              currentEntries.map((it) => ({
                _id: it._id,
                frequency: it.frequency,
                meaning: it.meaning
              }))
            )

            DictElement.insert(currentEntries.flatMap((it) => it.values))
          }

          await new Promise<void>((resolve, reject) => {
            db.save((err) => {
              err ? reject(err) : resolve()
            })
          })
        } else {
          Dict = db.getCollection('Dict')
          DictElement = db.getCollection('DictElement')
        }

        resolve(db)
      }
    })
  })
}

if (require.main === module) {
  initDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        db.close((err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
      })
  )
}
