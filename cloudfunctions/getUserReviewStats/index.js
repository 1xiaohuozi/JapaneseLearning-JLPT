const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const $ = db.command.aggregate

exports.main = async event => {
  const { userId } = event || {}
  if (!userId) {
    return { studyTotal: 0, speakingTotal: 0, wordTotal: 0 }
  }

  try {
    const [studyRes, speakingRes, wordRes] = await Promise.all([
      db.collection('user_study_records')
        .aggregate()
        .match({ user_id: userId })
        .group({ _id: null, total: $.sum('$review_count') })
        .end(),
      db.collection('user_speaking_records')
        .aggregate()
        .match({ user_id: userId })
        .group({ _id: null, total: $.sum('$play_count') })
        .end(),
      db.collection('user_word_records')
        .aggregate()
        .match({ user_id: userId })
        .group({
          _id: null,
          total: $.sum($.ifNull(['$review_count', $.ifNull(['$proficiency', 0])]))
        })
        .end()
    ])

    return {
      studyTotal: studyRes.list[0]?.total || 0,
      speakingTotal: speakingRes.list[0]?.total || 0,
      wordTotal: wordRes.list[0]?.total || 0
    }
  } catch (error) {
    console.error('getUserReviewStats failed', error)
    return {
      studyTotal: 0,
      speakingTotal: 0,
      wordTotal: 0,
      error: error.message || String(error)
    }
  }
}
