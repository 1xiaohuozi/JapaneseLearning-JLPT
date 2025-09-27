// cloudfunctions/getLeaderboard/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const $ = db.command.aggregate

// 安全转数值
const toNum = v => {
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return isNaN(n) ? 0 : n
  }
  if (typeof v === 'object') {
    if ('$numberDouble' in v) return Number(v.$numberDouble)
    if ('$numberLong' in v) return Number(v.$numberLong)
  }
  return 0
}

exports.main = async (event, context) => {
  const topN = Number(event.topN) || 10
  const currentUserId = event.currentUserId || null

  try {
    // ---------- unionWith 聚合 ----------
    try {
      const agg = await db.collection('user_study_records')
        .aggregate()
        .project({
          userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
          study: { $ifNull: ['$review_count', 0] },
          speak: { $literal: 0 },
          word: { $literal: 0 }
        })
        .unionWith({
          coll: 'user_speaking_records',
          pipeline: [
            {
              project: {
                userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
                study: { $literal: 0 },
                speak: { $ifNull: ['$play_count', 0] },
                word: { $literal: 0 }
              }
            }
          ]
        })
        .unionWith({
          coll: 'user_word_records',
          pipeline: [
            {
              project: {
                userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
                study: { $literal: 0 },
                speak: { $literal: 0 },
                word: { $ifNull: ['$proficiency', 0] }
              }
            }
          ]
        })
        .group({
          _id: '$userId',
          studyTotal: $.sum('$study'),
          speakingTotal: $.sum('$speak'),
          wordTotal: $.sum('$word')
        })
        .project({
          userId: '$_id',
          studyTotal: 1,
          speakingTotal: 1,
          wordTotal: 1,
          total: { $add: ['$studyTotal', '$speakingTotal', '$wordTotal'] }
        })
        .sort({ total: -1 })
        .limit(topN)
        .end()

      const leaderboard = (agg.list || []).map(it => ({
        userId: it.userId,
        studyTotal: toNum(it.studyTotal),
        speakingTotal: toNum(it.speakingTotal),
        wordTotal: toNum(it.wordTotal),
        totalCount: toNum(it.total || (toNum(it.studyTotal) + toNum(it.speakingTotal) + toNum(it.wordTotal)))
      }))

      // 当前用户
      let currentUser = null
      if (currentUserId) {
        const [uStudy, uSpeak, uWord] = await Promise.all([
          db.collection('user_study_records')
            .aggregate()
            .match({ $or: [{ user_id: currentUserId }, { _openid: currentUserId }, { userId: currentUserId }] })
            .group({ _id: null, studyTotal: $.sum('$review_count') })
            .end(),
          db.collection('user_speaking_records')
            .aggregate()
            .match({ $or: [{ user_id: currentUserId }, { _openid: currentUserId }, { userId: currentUserId }] })
            .group({ _id: null, speakingTotal: $.sum('$play_count') })
            .end(),
          db.collection('user_word_records')
            .aggregate()
            .match({ $or: [{ user_id: currentUserId }, { _openid: currentUserId }, { userId: currentUserId }] })
            .group({ _id: null, wordTotal: $.sum('$proficiency') })
            .end()
        ])

        const s = toNum(uStudy.list?.[0]?.studyTotal)
        const sp = toNum(uSpeak.list?.[0]?.speakingTotal)
        const w = toNum(uWord.list?.[0]?.wordTotal)
        const total = s + sp + w

        // 排名：比该用户分高的数量 + 1
        const gtRes = await db.collection('user_study_records')
          .aggregate()
          .project({
            userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
            study: { $ifNull: ['$review_count', 0] },
            speak: { $literal: 0 },
            word: { $literal: 0 }
          })
          .unionWith({
            coll: 'user_speaking_records',
            pipeline: [
              {
                project: {
                  userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
                  study: { $literal: 0 },
                  speak: { $ifNull: ['$play_count', 0] },
                  word: { $literal: 0 }
                }
              }
            ]
          })
          .unionWith({
            coll: 'user_word_records',
            pipeline: [
              {
                project: {
                  userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
                  study: { $literal: 0 },
                  speak: { $literal: 0 },
                  word: { $ifNull: ['$proficiency', 0] }
                }
              }
            ]
          })
          .group({
            _id: '$userId',
            total: $.sum({ $add: ['$study', '$speak', '$word'] })
          })
          .match({ total: { $gt: total } })
          .count('count')
          .end()

        const cnt = gtRes.list?.[0]?.count || 0
        currentUser = { userId: currentUserId, totalCount: total, rank: Number(cnt) + 1 }
      }

      return { success: true, leaderboard, currentUser }
    } catch (unionErr) {
      console.warn('⚠️ unionWith 聚合失败，走兼容模式:', unionErr)
    }

    // ---------- 兼容模式 ----------
    const [studyRes, speakRes, wordRes] = await Promise.all([
      db.collection('user_study_records')
        .aggregate()
        .project({
          userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
          val: { $ifNull: ['$review_count', 0] }
        })
        .group({ _id: '$userId', studyTotal: $.sum('$val') })
        .end(),
      db.collection('user_speaking_records')
        .aggregate()
        .project({
          userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
          val: { $ifNull: ['$play_count', 0] }
        })
        .group({ _id: '$userId', speakingTotal: $.sum('$val') })
        .end(),
      db.collection('user_word_records')
        .aggregate()
        .project({
          userId: { $ifNull: ['$user_id', { $ifNull: ['$_openid', '$userId'] }] },
          val: { $ifNull: ['$proficiency', 0] }
        })
        .group({ _id: '$userId', wordTotal: $.sum('$val') })
        .end()
    ])

    const map = new Map()
    ;(studyRes.list || []).forEach(it => {
      const id = it._id
      map.set(id, { userId: id, studyTotal: toNum(it.studyTotal), speakingTotal: 0, wordTotal: 0, totalCount: toNum(it.studyTotal) })
    })
    ;(speakRes.list || []).forEach(it => {
      const id = it._id
      const speakVal = toNum(it.speakingTotal)
      if (map.has(id)) {
        const o = map.get(id)
        o.speakingTotal = speakVal
        o.totalCount += speakVal
      } else {
        map.set(id, { userId: id, studyTotal: 0, speakingTotal: speakVal, wordTotal: 0, totalCount: speakVal })
      }
    })
    ;(wordRes.list || []).forEach(it => {
      const id = it._id
      const wordVal = toNum(it.wordTotal)
      if (map.has(id)) {
        const o = map.get(id)
        o.wordTotal = wordVal
        o.totalCount += wordVal
      } else {
        map.set(id, { userId: id, studyTotal: 0, speakingTotal: 0, wordTotal: wordVal, totalCount: wordVal })
      }
    })

    const combined = Array.from(map.values())
    combined.sort((a, b) => b.totalCount - a.totalCount)
    const leaderboard = combined.slice(0, topN)

    let currentUser = null
    if (currentUserId) {
      const found = map.get(currentUserId)
      const total = found ? found.totalCount : 0
      const rank = combined.filter(u => u.totalCount > total).length + 1
      currentUser = { userId: currentUserId, totalCount: total, rank }
    }

    return { success: true, leaderboard, currentUser }

  } catch (err) {
    console.error('排行榜云函数异常：', err)
    return { success: false, error: err.message || String(err) }
  }
}
