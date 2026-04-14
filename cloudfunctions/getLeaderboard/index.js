const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const $ = db.command.aggregate

function toNumber(value) {
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    if ('$numberDouble' in value) return Number(value.$numberDouble)
    if ('$numberLong' in value) return Number(value.$numberLong)
  }
  return 0
}

function resolveUserIdExpression() {
  return {
    $ifNull: [
      '$user_id',
      {
        $ifNull: [
          '$_openid',
          '$userId'
        ]
      }
    ]
  }
}

function isValidUserId(userId) {
  const normalized = String(userId || '').trim()
  if (!normalized) return false
  if (normalized === 'guest') return false
  if (normalized.startsWith('temp_')) return false
  return true
}

async function aggregateScores(collectionName, scoreExpression, resultKey) {
  const res = await db.collection(collectionName)
    .aggregate()
    .project({
      userId: resolveUserIdExpression(),
      score: scoreExpression
    })
    .group({
      _id: '$userId',
      score: $.sum('$score')
    })
    .end()

  return (res.list || [])
    .filter(item => isValidUserId(item._id))
    .map(item => ({
      userId: item._id,
      [resultKey]: toNumber(item.score)
    }))
}

function mergeScores(grammarRows, listeningRows, wordRows) {
  const userMap = new Map()

  const ensureUser = userId => {
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        userId,
        grammarScore: 0,
        listeningScore: 0,
        wordScore: 0,
        totalScore: 0
      })
    }
    return userMap.get(userId)
  }

  grammarRows.forEach(row => {
    ensureUser(row.userId).grammarScore = toNumber(row.grammarScore)
  })

  listeningRows.forEach(row => {
    ensureUser(row.userId).listeningScore = toNumber(row.listeningScore)
  })

  wordRows.forEach(row => {
    ensureUser(row.userId).wordScore = toNumber(row.wordScore)
  })

  const combined = Array.from(userMap.values()).map(item => ({
    ...item,
    totalScore: item.grammarScore + item.listeningScore + item.wordScore
  }))

  combined.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore
    if (b.wordScore !== a.wordScore) return b.wordScore - a.wordScore
    if (b.grammarScore !== a.grammarScore) return b.grammarScore - a.grammarScore
    if (b.listeningScore !== a.listeningScore) return b.listeningScore - a.listeningScore
    return String(a.userId).localeCompare(String(b.userId))
  })

  return combined.map((item, index) => ({
    ...item,
    rank: index + 1
  }))
}

exports.main = async event => {
  const limit = Math.max(20, Number(event.limit) || 50)
  const currentUserId = String(event.currentUserId || '').trim()

  try {
    const [grammarRows, listeningRows, wordRows] = await Promise.all([
      aggregateScores('user_study_records', { $ifNull: ['$review_count', 0] }, 'grammarScore'),
      aggregateScores('user_speaking_records', { $ifNull: ['$play_count', 0] }, 'listeningScore'),
      aggregateScores(
        'user_word_records',
        {
          $ifNull: [
            '$review_count',
            { $ifNull: ['$proficiency', 0] }
          ]
        },
        'wordScore'
      )
    ])

    const leaderboard = mergeScores(grammarRows, listeningRows, wordRows)
    const topList = leaderboard.slice(0, limit)

    let currentUser = null
    let aroundMe = []
    if (currentUserId) {
      const index = leaderboard.findIndex(item => item.userId === currentUserId)
      if (index >= 0) {
        currentUser = leaderboard[index]
        aroundMe = leaderboard.slice(Math.max(0, index - 2), Math.min(leaderboard.length, index + 3))
      }
    }

    return {
      success: true,
      leaderboard: topList,
      currentUser,
      aroundMe,
      totalUsers: leaderboard.length
    }
  } catch (error) {
    console.error('getLeaderboard failed', error)
    return {
      success: false,
      error: error.message || String(error)
    }
  }
}
