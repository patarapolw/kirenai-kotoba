import path from 'path'

import fastify from 'fastify'
import fasitfyStatic from 'fastify-static'
import S from 'jsonschema-definer'
import pov from 'point-of-view'

import { Dict, DictElement, initDB } from './db/loki'
import { expandSmall, reKana, sDictMeaning } from './db/types'

async function main() {
  await initDB()

  const PORT = process.env['PORT'] || 8080
  const isDev = process.env['NODE_ENV'] === 'development'

  const app = fastify({
    logger: {
      prettyPrint: isDev
    }
  })

  app.register(fasitfyStatic, {
    root: path.join(__dirname, '../public')
  })

  app.register(pov, {
    engine: {
      ejs: require('ejs')
    },
    root: path.join(__dirname, '../template')
  })

  {
    const sQuery = S.shape({
      length: S.integer().minimum(1),
      tag: S.string(),
      exclude: S.string(),
      within: S.string(),
      repeat: S.string().enum('on').optional(),
      small: S.string().enum('on').optional(),
      format: S.string().enum('txt', 'json'),
      offset: S.integer().minimum(0).optional(),
      limit: S.integer().minimum(-1).optional()
    })

    const sJsonResponse = S.shape({
      meta: S.shape({
        offset: S.integer(),
        limit: S.integer(),
        count: S.integer(),
        previous: S.string().optional(),
        next: S.string().optional()
      }),
      data: S.list(
        S.shape({
          ja: S.list(S.string()),
          en: S.list(sDictMeaning)
        }).additionalProperties(true)
      )
    })

    const sResponse = S.anyOf(S.string(), sJsonResponse)

    app.get<{
      Querystring: typeof sQuery.type
    }>(
      '/generate',
      {
        schema: {
          querystring: sQuery.valueOf(),
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        const {
          length,
          tag: _tag,
          exclude,
          within,
          repeat,
          small,
          format,
          offset = 0,
          limit = 100
        } = req.query

        const tags = new Set(_tag.split(' '))

        const $and: any[] = [{ length }]

        if (tags.has('common')) {
          tags.delete('common')
          $and.push({ primary: true })
        }

        if (exclude) {
          let chars = Array.from(exclude.matchAll(reKana)).map((m) => m[0]!)
          if (small) {
            chars = expandSmall(chars)
          }

          $and.push({
            kana: {
              $containsNone: chars
            }
          })
        }

        if (within) {
          let chars = Array.from(within.matchAll(reKana)).map((m) => m[0]!)
          if (small) {
            chars = expandSmall(chars)
          }

          $and.push({
            kana: {
              $containsAny: chars
            }
          })
        }

        if (small) {
          $and.push({ repeatx: repeat ? { $gt: 0 } : 0 })
        } else {
          $and.push({ repeat: repeat ? { $gt: 0 } : 0 })
        }

        const entries = Dict.chain()
          .find({
            _id: {
              $in: [...new Set(DictElement.find({ $and }).map((r) => r.dict))]
            }
          })
          .simplesort('frequency', { desc: true })
          .data()

        const out: typeof sJsonResponse.type = {
          data: entries
            .slice(offset, limit > 0 ? offset + limit : undefined)
            .map((r) => ({
              ja: DictElement.find({ dict: r._id, primary: true }).map(
                (el) => el.value
              ),
              en: r.meaning
            })),
          meta: {
            count: entries.length,
            offset,
            limit: limit || -1
          }
        }

        if (format === 'json') {
          return out
        }

        return out.data
          .map(
            (d) => `${d.ja.join(' ')} - ${d.en.map((m) => m.gloss).join(' / ')}`
          )
          .join('\n')
      }
    )
  }

  app.get('/', (_, reply) => {
    reply.view('index')
  })

  app.listen(PORT, isDev ? '' : '0.0.0.0')
}

if (require.main === module) {
  main()
}
