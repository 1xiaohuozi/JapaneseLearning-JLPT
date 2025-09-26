// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()
const $ = db.command.aggregate

// 云函数入口
exports.main = async (event, context) => {
  const { userId } = event
  if (!userId) {
    return { studyTotal: 0, speakingTotal: 0, wordTotal: 0 }
  }

  try {
    // 1️⃣ 语法统计
    const studyRes = await db.collection('user_study_records')
      .aggregate()
      .match({ user_id: userId })
      .group({ _id: null, total: $.sum('$review_count') })
      .end()
    const studyTotal = studyRes.list[0]?.total || 0

    // 2️⃣ 听力统计
    const speakingRes = await db.collection('user_speaking_records')
      .aggregate()
      .match({ user_id: userId })
      .group({ _id: null, total: $.sum('$play_count') })
      .end()
    const speakingTotal = speakingRes.list[0]?.total || 0

    // 3️⃣ 单词统计
    const wordRes = await db.collection('user_word_records')
      .aggregate()
      .match({ user_id: userId })
      .group({ _id: null, total: $.sum('$proficiency') })
      .end()
    const wordTotal = wordRes.list[0]?.total || 0

    return { studyTotal, speakingTotal, wordTotal }
  } catch (e) {
    console.error('云函数统计失败:', e)
    // ⚠️ 必须 return，不能直接 throw，不然会触发 "exit unexpected"
    return { studyTotal: 0, speakingTotal: 0, wordTotal: 0, error: e.message }
  }
}
