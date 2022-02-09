import { DictElementModel, mongooseConnect } from '@/db/mongo'

async function main() {
  const conn = await mongooseConnect()

  await DictElementModel.aggregate([
    { $match: { $and: [{ primary: true }] } },
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
          { $skip: 0 },
          { $limit: 100 },
          {
            $lookup: {
              from: 'DictElement',
              pipeline: [
                {
                  $match: {
                    primary: true,
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
  ]).then((r) => console.dir(r, { depth: null }))

  await conn.disconnect()
}

if (require.main === module) {
  main()
}
