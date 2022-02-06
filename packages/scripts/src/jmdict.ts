import fs from 'fs'

import sqlite3 from 'better-sqlite3'
import cheerio from 'cheerio'
import flow, { toXml } from 'xml-flow'

export const JMDICT_RAW = './cache/JMdict_e.xml'

export class JMdictXML {
  $: ReturnType<typeof cheerio.load>

  constructor(public filename = JMDICT_RAW) {
    this.$ = cheerio.load(fs.readFileSync(this.filename), {
      decodeEntities: true
    })
  }

  lookup(v: string) {
    const type = /\p{sc=Han}/u.test(v) ? 'keb' : 'reb'
    return this.$(`${type}:contains("${v}")`).parents('entry')
  }
}

export class JMDictSQLite {
  static async build(xml = JMDICT_RAW, filename?: string) {
    const xmlFlow = flow(fs.createReadStream(xml))
    const db = new JMDictSQLite(filename, false)

    db.sql.exec(/* sql */ `
    CREATE VIRTUAL TABLE jmdict USING fts5(
      id,
      k,
      k2,
      r,
      r2,
      "xml" UNINDEXED
    );
    `)

    const stmt = db.sql.prepare(/* sql */ `
    INSERT INTO jmdict (id, k, k2, r, r2, "xml")
    VALUES (@id, @k, @k2, @r, @r2, @xml)
    `)

    const batchSize = 1000
    const entries: Record<string, string>[] = []
    let i = 0

    xmlFlow.on('tag:entry', (ent) => {
      const xml = toXml(ent)
      const $ = cheerio.load(xml)

      const id = $('ent_seq').text()

      const k: string[] = []
      const k2: string[] = []
      $('k_ele').each((_, k_ele) => {
        const $k_ele = $(k_ele)
        if ($k_ele.find('ke_pri').length) {
          k.push($k_ele.find('keb').text())
        } else {
          k2.push($k_ele.find('keb').text())
        }
      })

      const r: string[] = []
      const r2: string[] = []
      $('r_ele').each((_, r_ele) => {
        const $r_ele = $(r_ele)
        if ($r_ele.find('re_pri').length) {
          r.push($r_ele.find('reb').text())
        } else {
          r2.push($r_ele.find('reb').text())
        }
      })

      entries.push({
        id,
        k: k.join(' '),
        k2: k2.join(' '),
        r: r.join(' '),
        r2: r2.join(' '),
        xml
      })

      if (entries.length > i + batchSize) {
        const j = i
        i += batchSize
        db.sql.transaction(() => {
          for (const ent of entries.slice(j, j + batchSize)) {
            stmt.run(ent)
          }
        })()
      }
    })

    await new Promise((resolve, reject) => {
      xmlFlow.once('end', resolve).once('error', reject)
    })

    return db
  }

  sql: sqlite3.Database

  constructor(public filename = './cache/jmdict.sqlite', readonly = true) {
    this.sql = sqlite3(filename, { readonly })
  }

  lookup(v: string) {
    return this.sql
      .prepare(
        /* sql */ `
    SELECT * FROM jmdict(@v)
    `
      )
      .all({ v })
  }
}

if (require.main === module) {
  JMDictSQLite.build()
}
