// 云函数入口文件
const cloud = require('wx-server-sdk')

// ✅ 必须加 env 初始化，不然就是 INVALID_ENV
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 每次最多拉取 100 条
const MAX_LIMIT = 100

exports.main = async (event, context) => {
  try {
    // 获取集合总数
    const countRes = await db.collection("shadowing").count()
    const total = countRes.total
    const batchTimes = Math.ceil(total / MAX_LIMIT)

    let updatedCount = 0

    // 分批获取数据
    for (let i = 0; i < batchTimes; i++) {
      const res = await db.collection("shadowing")
        .skip(i * MAX_LIMIT)
        .limit(MAX_LIMIT)
        .get()

      const tasks = res.data.map(item => {
        const orderNum = Number(item.order)
        if (!isNaN(orderNum)) {
          updatedCount++
          return db.collection("shadowing").doc(item._id).update({
            data: {
              order: orderNum
            }
          })
        } else {
          return Promise.resolve() // 跳过无效的
        }
      })

      await Promise.all(tasks)
    }

    return {
      success: true,
      updated: updatedCount,
      total
    }
  } catch (err) {
    return {
      success: false,
      error: err.toString()
    }
  }
}
