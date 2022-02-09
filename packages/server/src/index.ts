import path from 'path'

import fastify from 'fastify'
import fasitfyStatic from 'fastify-static'
import S from 'jsonschema-definer'
import pov from 'point-of-view'

import { DictElementModel, IDictMeaning } from './db/mongo'

async function main() {
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
      format: S.string().enum('tsv', 'csv', 'json'),
      offset: S.integer().minimum(0).optional(),
      limit: S.integer().minimum(-1).optional()
    })

    const sResponse = S.anyOf(
      S.string(),
      S.shape({
        meta: S.shape({
          offset: S.integer(),
          limit: S.integer(),
          count: S.integer(),
          previous: S.string().optional(),
          next: S.string().optional()
        }),
        data: S.list(S.shape({}).additionalProperties(true))
      })
    )

    const reJa = /[\p{sc=Han}\p{sc=Katakana}\p{sc=Hiragana}]/gu

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
          format,
          offset = 0,
          limit = 100
        } = req.query

        const tags = new Set(_tag.split(' '))

        const $and: any[] = [{ length }]

        let isCommon = false
        if (tags.has('common')) {
          tags.delete('common')
          $and.push({ primary: true })
          isCommon = true
        }

        if (exclude) {
          $and.push({
            value: new RegExp(
              `[^${Array.from(exclude.matchAll(reJa))
                .map((m) => m[0])
                .join('')}]`
            )
          })
        }

        if (within) {
          $and.push({
            value: new RegExp(
              `[${Array.from(within.matchAll(reJa))
                .map((m) => m[0])
                .join('')}]`
            )
          })
        }

        const r: {
          data: {
            meaning: IDictMeaning[]
            japanese: {
              value: string
            }[]
          }[]
          meta: {
            count: number
          }[]
        }[] = await DictElementModel.aggregate([
          { $match: { $and } },
          { $group: { _id: '$dict' } },
          {
            $lookup: {
              localField: '_id',
              foreignField: '_id',
              from: 'Dict',
              as: 'd'
            }
          },
          { $sort: { 'd.frequency': -1 } },
          {
            $facet: {
              data: [
                { $skip: offset },
                ...(limit > 0 ? [{ $limit: limit }] : []),
                {
                  $lookup: {
                    from: 'DictElement',
                    pipeline: [
                      {
                        $match: {
                          ...(isCommon ? { primary: true } : {}),
                          dict: '$_id'
                        }
                      },
                      { $project: { _id: 0, value: 1 } }
                    ],
                    as: 'japanese'
                  }
                },
                {
                  $project: {
                    _id: 0,
                    meaning: { $first: '$d.meaning' },
                    japanese: 1
                  }
                }
              ],
              meta: [{ $count: 'count' }]
            }
          }
        ])

        if (!r[0]) {
          if (format === 'json') {
            return {
              meta: {
                count: 0,
                offset,
                limit: limit || -1
              },
              data: []
            }
          }
          return ''
        }

        if (format === 'json') {
          return {
            meta: {
              count: r[0].meta[0]?.count || 0,
              offset,
              limit: limit || -1
            },
            data: r[0].data
          }
        }

        return r[0].data
          .map(
            (d) =>
              `${d.japanese.map((ja) => ja.value).join(' ')} ${d.meaning
                .map((m) => m.gloss)
                .join(' / ')}`
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
