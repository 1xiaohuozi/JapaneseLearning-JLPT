const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const MAX_BATCH = 100
const DEFAULT_PROFILE = {
  collection: 'n2_words',
  newLimit: 20,
  reviewLimit: 40
}

function getProfileDocId(userId) {
  return `profile_${userId}`
}

function chunk(list, size = MAX_BATCH) {
  const result = []
  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size))
  }
  return result
}

async function getAllByQuery(collectionName, where = {}, options = {}) {
  const field = options.field || null
  const orderBy = options.orderBy || null
  const countRes = await db.collection(collectionName).where(where).count()
  const total = countRes.total || 0
  const tasks = []

  for (let skip = 0; skip < total; skip += MAX_BATCH) {
    let query = db.collection(collectionName).where(where).skip(skip).limit(MAX_BATCH)
    if (field) query = query.field(field)
    if (orderBy) query = query.orderBy(orderBy.field, orderBy.order)
    tasks.push(query.get())
  }

  const pages = await Promise.all(tasks)
  return pages.flatMap(page => page.data || [])
}

async function getWordsByIds(collectionName, ids) {
  if (!ids.length) return []

  const parts = await Promise.all(
    chunk(ids).map(part =>
      db.collection(collectionName)
        .where({ _id: _.in(part) })
        .get()
    )
  )

  return parts.flatMap(res => res.data || [])
}

function normalizeWord(word, recordMap, favoriteSet, sessionType = 'library') {
  const record = recordMap[word._id] || {}
  return {
    ...word,
    proficiency: record.proficiency || 0,
    nextReview: record.nextReview || null,
    stability: record.stability || 0,
    hasRecord: !!recordMap[word._id],
    isFavorited: favoriteSet.has(word._id),
    sessionType
  }
}

function getSchedule(proficiency, rating) {
  const byRating = {
    again: [
      10 * 60 * 1000,
      15 * 60 * 1000,
      30 * 60 * 1000,
      60 * 60 * 1000,
      2 * 60 * 60 * 1000,
      4 * 60 * 60 * 1000
    ],
    hard: [
      30 * 60 * 1000,
      6 * 60 * 60 * 1000,
      12 * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      2 * 24 * 60 * 60 * 1000,
      4 * 24 * 60 * 60 * 1000
    ],
    good: [
      12 * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      3 * 24 * 60 * 60 * 1000,
      5 * 24 * 60 * 60 * 1000,
      7 * 24 * 60 * 60 * 1000,
      14 * 24 * 60 * 60 * 1000
    ]
  }

  const table = byRating[rating] || byRating.good
  const index = Math.max(0, Math.min(proficiency, table.length - 1))
  return table[index]
}

function buildSessionQueue(dueWords, newWords) {
  const dueQueue = dueWords.slice()
  const newQueue = newWords.slice()
  const session = []

  while (dueQueue.length || newQueue.length) {
    if (dueQueue.length) session.push(dueQueue.shift())
    if (dueQueue.length) session.push(dueQueue.shift())
    if (newQueue.length) session.push(newQueue.shift())
  }

  return session
}

function getDefaultProgress() {
  return {
    dateKey: '',
    queueIds: [],
    currentWordId: '',
    currentIndex: 0,
    sessionStats: {
      reviewed: 0,
      completed: 0,
      again: 0,
      hard: 0,
      good: 0,
      newDone: 0,
      reviewDone: 0
    },
    planStats: {},
    updatedAt: 0
  }
}

function getTodayKey() {
  const date = new Date()
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function resolveDateKey(inputDateKey) {
  if (typeof inputDateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(inputDateKey)) {
    return inputDateKey
  }
  return getTodayKey()
}

async function readProgress(userId, collection) {
  if (!userId || !collection) return null
  const docId = `${userId}_${collection}`

  try {
    const doc = await db.collection('user_word_progress').doc(docId).get()
    return {
      dateKey: doc.data.date_key || '',
      queueIds: doc.data.queue_ids || [],
      currentWordId: doc.data.current_word_id || '',
      currentIndex: doc.data.current_index || 0,
      sessionStats: doc.data.stats || getDefaultProgress().sessionStats,
      planStats: doc.data.plan_stats || {},
      updatedAt: doc.data.client_updated_at || 0
    }
  } catch (error) {
    return null
  }
}

async function buildSession({ userId, collection, newLimit = 20, reviewLimit = 40, dateKey }) {
  const totalRes = await db.collection(collection).count()
  const totalWords = totalRes.total || 0
  const todayKey = resolveDateKey(dateKey)

  const [records, favorites] = userId
    ? await Promise.all([
        getAllByQuery('user_word_records', { user_id: userId, collection }),
        getAllByQuery('user_word_favorites', { user_id: userId, collection }, { field: { word_id: true } })
      ])
    : [[], []]

  const favoriteSet = new Set((favorites || []).map(item => item.word_id))
  const recordMap = {}
  const learnedIds = new Set()
  const dueRecordIds = []

  const now = Date.now()
  records.forEach(record => {
    recordMap[record.word_id] = record
    learnedIds.add(record.word_id)

    if (!record.nextReview || new Date(record.nextReview).getTime() <= now) {
      dueRecordIds.push(record.word_id)
    }
  })

  const dueWordsRaw = await getWordsByIds(collection, dueRecordIds.slice(0, reviewLimit))
  const dueWordMap = new Map(dueWordsRaw.map(word => [word._id, word]))
  const dueWords = dueRecordIds
    .slice(0, reviewLimit)
    .map(id => dueWordMap.get(id))
    .filter(Boolean)
    .map(word => normalizeWord(word, recordMap, favoriteSet, 'review'))

  const newWords = []
  if (newLimit > 0 && learnedIds.size < totalWords) {
    let skip = 0

    while (newWords.length < newLimit && skip < totalWords) {
      const batchRes = await db.collection(collection)
        .orderBy('order', 'asc')
        .skip(skip)
        .limit(MAX_BATCH)
        .get()

      const candidates = (batchRes.data || []).filter(word => !learnedIds.has(word._id))
      candidates.forEach(word => {
        if (newWords.length < newLimit) {
          newWords.push(normalizeWord(word, recordMap, favoriteSet, 'new'))
        }
      })

      if ((batchRes.data || []).length < MAX_BATCH) break
      skip += MAX_BATCH
    }
  }

  const masteredCount = records.filter(record => (record.proficiency || 0) >= 5).length
  const freshStats = {
    totalWords,
    learnedWords: learnedIds.size,
    dueCount: dueRecordIds.length,
    availableNewCount: Math.max(totalWords - learnedIds.size, 0),
    masteredCount,
    sessionSize: dueWords.length + newWords.length,
    reviewPlanned: dueWords.length,
    newPlanned: newWords.length
  }

  if (userId) {
    const savedProgress = await readProgress(userId, collection)
    if (
      savedProgress &&
      savedProgress.dateKey === todayKey &&
      Array.isArray(savedProgress.queueIds)
    ) {
      const savedWordsRaw = await getWordsByIds(collection, savedProgress.queueIds)
      const savedWordMap = new Map(savedWordsRaw.map(word => [word._id, word]))
      const savedWords = savedProgress.queueIds
        .map(id => savedWordMap.get(id))
        .filter(Boolean)
        .map(word => normalizeWord(
          word,
          recordMap,
          favoriteSet,
          learnedIds.has(word._id) ? 'review' : 'new'
        ))

      return {
        sessionWords: savedWords,
        stats: {
          ...freshStats,
          ...(savedProgress.planStats || {})
        },
        progress: savedProgress
      }
    }
  }

  return {
    sessionWords: buildSessionQueue(dueWords, newWords),
    stats: freshStats
  }
}

async function updateRecord({ userId, word_id, collection, rating = 'good' }) {
  if (!userId || !word_id || !collection) {
    return { ok: false, error: 'missing_params' }
  }

  const now = new Date()
  const res = await db.collection('user_word_records')
    .where({ user_id: userId, word_id, collection })
    .limit(1)
    .get()

  const existing = res.data[0]
  const oldProficiency = existing ? (existing.proficiency || 0) : 0
  let newProficiency = oldProficiency

  if (rating === 'again') {
    newProficiency = Math.max(0, oldProficiency - 1)
  } else if (rating === 'hard') {
    newProficiency = Math.max(0, oldProficiency)
  } else {
    newProficiency = Math.min(6, oldProficiency + 1)
  }

  const previousStability = existing ? (existing.stability || 0.6) : 0.6
  const stabilityMultiplier = rating === 'again' ? 0.6 : rating === 'hard' ? 1.05 : 1.6
  const stabilityBonus = rating === 'again' ? 0.1 : rating === 'hard' ? 0.25 : 0.6
  const stability = Math.max(0.2, previousStability * stabilityMultiplier + stabilityBonus)
  const intervalMs = Math.max(getSchedule(newProficiency, rating), Math.round(stability * 60 * 60 * 1000))
  const nextReview = new Date(now.getTime() + intervalMs)

  const baseData = {
    proficiency: newProficiency,
    stability,
    nextReview,
    lastSeen: db.serverDate(),
    lastRating: rating,
    update_time: db.serverDate()
  }

  if (existing) {
    await db.collection('user_word_records').doc(existing._id).update({
      data: {
        ...baseData,
        review_count: _.inc(1)
      }
    })
  } else {
    await db.collection('user_word_records').add({
      data: {
        user_id: userId,
        collection,
        word_id,
        review_count: 1,
        create_time: db.serverDate(),
        ...baseData
      }
    })
  }

  return {
    ok: true,
    proficiency: newProficiency,
    stability,
    nextReview,
    intervalMs
  }
}

async function toggleFavorite({ userId, word_id, collection }) {
  if (!userId || !word_id) return { ok: false }

  const res = await db.collection('user_word_favorites')
    .where({ user_id: userId, word_id })
    .limit(1)
    .get()

  if (res.data.length) {
    await db.collection('user_word_favorites').doc(res.data[0]._id).remove()
    return { ok: true, status: false }
  }

  await db.collection('user_word_favorites').add({
    data: {
      user_id: userId,
      word_id,
      collection,
      create_time: db.serverDate()
    }
  })

  return { ok: true, status: true }
}

async function getFavorites({ userId, collection, skip = 0, limit = 20 }) {
  if (!userId) return { words: [], hasMore: false }

  const favDocs = await db.collection('user_word_favorites')
    .where({ user_id: userId, collection })
    .orderBy('create_time', 'desc')
    .skip(skip)
    .limit(limit)
    .get()

  const ids = favDocs.data.map(item => item.word_id)
  if (!ids.length) return { words: [], hasMore: false }

  const words = await getWordsByIds(collection, ids)
  const wordMap = new Map(words.map(word => [word._id, word]))

  return {
    words: ids.map(id => wordMap.get(id)).filter(Boolean),
    hasMore: favDocs.data.length >= limit
  }
}

async function getProgress({ userId, collection }) {
  return { progress: await readProgress(userId, collection) }
}

async function saveProgress({ userId, collection, payload }) {
  if (!userId || !collection || !payload) return { ok: false }
  const docId = `${userId}_${collection}`
  const stats = payload.sessionStats || payload.stats || {}

  await db.collection('user_word_progress').doc(docId).set({
    data: {
      user_id: userId,
      collection,
      date_key: payload.dateKey || '',
      current_word_id: payload.currentWordId || '',
      current_index: payload.currentIndex || 0,
      queue_ids: payload.queueIds || [],
      completed_count: payload.completedCount || 0,
      stats,
      plan_stats: payload.planStats || {},
      client_updated_at: payload.updatedAt || Date.now(),
      update_time: db.serverDate()
    }
  })

  return { ok: true }
}

async function getUserProfile({ userId }) {
  if (!userId) {
    return { profile: { ...DEFAULT_PROFILE }, hasProfile: false }
  }

  try {
    const doc = await db.collection('user_word_progress').doc(getProfileDocId(userId)).get()
    return {
      profile: {
        ...DEFAULT_PROFILE,
        collection: doc.data.collection || DEFAULT_PROFILE.collection,
        newLimit: Number(doc.data.new_limit) || DEFAULT_PROFILE.newLimit,
        reviewLimit: Number(doc.data.review_limit) || DEFAULT_PROFILE.reviewLimit
      },
      hasProfile: true
    }
  } catch (error) {
    return { profile: { ...DEFAULT_PROFILE }, hasProfile: false }
  }
}

async function saveUserProfile({ userId, payload }) {
  if (!userId || !payload) return { ok: false }

  await db.collection('user_word_progress').doc(getProfileDocId(userId)).set({
    data: {
      doc_type: 'profile',
      user_id: userId,
      collection: payload.collection || DEFAULT_PROFILE.collection,
      new_limit: Number(payload.newLimit) || DEFAULT_PROFILE.newLimit,
      review_limit: Number(payload.reviewLimit) || DEFAULT_PROFILE.reviewLimit,
      update_time: db.serverDate()
    }
  })

  return {
    ok: true,
    profile: {
      collection: payload.collection || DEFAULT_PROFILE.collection,
      newLimit: Number(payload.newLimit) || DEFAULT_PROFILE.newLimit,
      reviewLimit: Number(payload.reviewLimit) || DEFAULT_PROFILE.reviewLimit
    }
  }
}

async function clearProgress({ userId, collection }) {
  if (!userId || !collection) return { ok: false }
  const docId = `${userId}_${collection}`

  try {
    await db.collection('user_word_progress').doc(docId).remove()
  } catch (error) {
    return { ok: true }
  }

  return { ok: true }
}

exports.main = async (event) => {
  const { action } = event

  try {
    switch (action) {
      case 'buildSession':
        return await buildSession(event)
      case 'updateRecord':
        return await updateRecord(event)
      case 'toggleFavorite':
        return await toggleFavorite(event)
      case 'getFavorites':
        return await getFavorites(event)
      case 'getProgress':
        return await getProgress(event)
      case 'saveProgress':
        return await saveProgress(event)
      case 'clearProgress':
        return await clearProgress(event)
      case 'getUserProfile':
        return await getUserProfile(event)
      case 'saveUserProfile':
        return await saveUserProfile(event)
      default:
        return { ok: false, error: `Unknown action: ${action}` }
    }
  } catch (error) {
    console.error('lafService error', action, error)
    return { ok: false, error: error.message || String(error) }
  }
}
