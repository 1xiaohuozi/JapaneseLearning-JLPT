const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const MAX_BATCH = 100
const DEFAULT_PROFILE = {
  collection: 'n2_words',
  newLimit: 20,
  reviewLimit: 40,
  lastNewOrder: 0
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

async function getRecordsByWordIds(userId, collection, ids) {
  if (!userId || !collection || !ids.length) return []

  const parts = await Promise.all(
    chunk(ids).map(part =>
      db.collection('user_word_records')
        .where({
          user_id: userId,
          collection,
          word_id: _.in(part)
        })
        .field({ word_id: true, proficiency: true, nextReview: true, stability: true, word_order: true })
        .get()
    )
  )

  return parts.flatMap(res => res.data || [])
}

async function readProfileDoc(userId) {
  if (!userId) return null
  try {
    const doc = await db.collection('user_word_progress').doc(getProfileDocId(userId)).get()
    return doc.data || null
  } catch (error) {
    return null
  }
}

async function getFavoriteSetByWordIds(userId, collection, ids) {
  if (!userId || !collection || !ids.length) return new Set()

  const parts = await Promise.all(
    chunk(ids).map(part =>
      db.collection('user_word_favorites')
        .where({
          user_id: userId,
          collection,
          word_id: _.in(part)
        })
        .field({ word_id: true })
        .get()
    )
  )

  return new Set(
    parts
      .flatMap(res => res.data || [])
      .map(item => item.word_id)
  )
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

async function buildSession({ userId, collection, newLimit = 20, reviewLimit = 40, dateKey, contentMode = 'cloud', totalWordsHint = 0 }) {
  const totalWords = Number(totalWordsHint) || (await db.collection(collection).count()).total || 0
  const todayKey = resolveDateKey(dateKey)
  const nowDate = new Date()

  const [
    learnedCountRes,
    masteredCountRes,
    dueCountRes,
    dueRecordRes,
    profileDoc
  ] = userId
    ? await Promise.all([
        db.collection('user_word_records').where({ user_id: userId, collection }).count(),
        db.collection('user_word_records').where({
          user_id: userId,
          collection,
          proficiency: _.gte(5)
        }).count(),
        db.collection('user_word_records').where({
          user_id: userId,
          collection,
          nextReview: _.lte(nowDate)
        }).count(),
        db.collection('user_word_records').where({
          user_id: userId,
          collection,
          nextReview: _.lte(nowDate)
        })
          .orderBy('nextReview', 'asc')
          .limit(reviewLimit)
          .field({ word_id: true, proficiency: true, nextReview: true, stability: true, word_order: true })
          .get(),
        readProfileDoc(userId)
      ])
    : [{ total: 0 }, { total: 0 }, { total: 0 }, { data: [] }, null]

  const learnedWords = learnedCountRes.total || 0
  const masteredCount = masteredCountRes.total || 0
  const dueCount = dueCountRes.total || 0
  const dueRecords = dueRecordRes.data || []
  const dueRecordIds = dueRecords.map(record => record.word_id)
  const dueRecordMap = {}
  dueRecords.forEach(record => {
    dueRecordMap[record.word_id] = record
  })

  const dueWordsRaw = await getWordsByIds(collection, dueRecordIds)
  const dueWordMap = new Map(dueWordsRaw.map(word => [word._id, word]))

  const queuedNewIds = []
  const queuedNewWordMap = new Map()
  const recordMap = { ...dueRecordMap }
  let lastNewOrder = Number(profileDoc?.last_new_order) || 0

  if (newLimit > 0 && learnedWords < totalWords) {
    let wrapped = false
    let cursor = lastNewOrder

    while (queuedNewIds.length < newLimit) {
      let query = db.collection(collection).orderBy('order', 'asc').limit(MAX_BATCH)
      if (cursor > 0 && !wrapped) {
        query = query.where({ order: _.gt(cursor) })
      }

      const batchRes = await query.get()
      const batchWords = batchRes.data || []
      if (!batchWords.length) {
        if (wrapped || cursor <= 0) break
        wrapped = true
        cursor = 0
        continue
      }

      const existingRecords = await getRecordsByWordIds(
        userId,
        collection,
        batchWords.map(word => word._id)
      )
      const existingSet = new Set(existingRecords.map(record => record.word_id))
      existingRecords.forEach(record => {
        recordMap[record.word_id] = record
      })

      batchWords.forEach(word => {
        if (queuedNewIds.length >= newLimit) return
        if (!existingSet.has(word._id)) {
          queuedNewIds.push(word._id)
          queuedNewWordMap.set(word._id, word)
          lastNewOrder = Math.max(lastNewOrder, Number(word.order) || 0)
        }
      })

      const lastBatchOrder = Number(batchWords[batchWords.length - 1]?.order) || 0
      if (batchWords.length < MAX_BATCH) {
        if (wrapped) break
        wrapped = true
        cursor = 0
      } else {
        cursor = lastBatchOrder
      }
    }
  }

  const sessionIds = dueRecordIds.concat(queuedNewIds)
  const favoriteSet = await getFavoriteSetByWordIds(userId, collection, sessionIds)
  const dueWords = dueRecordIds
    .map(id => dueWordMap.get(id))
    .filter(Boolean)
    .map(word => normalizeWord(word, recordMap, favoriteSet, 'review'))

  const newWords = queuedNewIds
    .map(id => queuedNewWordMap.get(id))
    .filter(Boolean)
    .map(word => normalizeWord(word, recordMap, favoriteSet, 'new'))

  const toSessionEntry = word => ({
    word_id: word._id,
    proficiency: word.proficiency || 0,
    stability: word.stability || 0,
    nextReview: word.nextReview || null,
    hasRecord: !!word.hasRecord,
    isFavorited: !!word.isFavorited,
    sessionType: word.sessionType || 'new'
  })

  const freshStats = {
    totalWords,
    learnedWords,
    dueCount,
    availableNewCount: Math.max(totalWords - learnedWords, 0),
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
      if (!savedProgress.queueIds.length && freshStats.sessionSize > 0) {
        // Ignore stale empty progress snapshots when a fresh session can be built.
      } else {
      const savedWordsRaw = await getWordsByIds(collection, savedProgress.queueIds)
      const savedWordMap = new Map(savedWordsRaw.map(word => [word._id, word]))
      const savedFavoriteSet = await getFavoriteSetByWordIds(userId, collection, savedProgress.queueIds)
      const savedWords = savedProgress.queueIds
        .map(id => savedWordMap.get(id))
        .filter(Boolean)
        .map(word => normalizeWord(
          word,
          recordMap,
          savedFavoriteSet,
          recordMap[word._id] ? 'review' : 'new'
        ))

      return {
        sessionWords: contentMode === 'local' ? [] : savedWords,
        sessionEntries: contentMode === 'local' ? savedWords.map(toSessionEntry) : [],
        stats: {
          ...freshStats,
          ...(savedProgress.planStats || {})
        },
        progress: savedProgress
      }
      }
    }
  }

  if (userId && lastNewOrder !== (Number(profileDoc?.last_new_order) || 0)) {
    await db.collection('user_word_progress').doc(getProfileDocId(userId)).set({
      data: {
        doc_type: 'profile',
        user_id: userId,
        collection: profileDoc?.collection || collection,
        new_limit: Number(profileDoc?.new_limit) || DEFAULT_PROFILE.newLimit,
        review_limit: Number(profileDoc?.review_limit) || DEFAULT_PROFILE.reviewLimit,
        last_new_order: lastNewOrder,
        update_time: db.serverDate()
      }
    })
  }

  return {
    sessionWords: contentMode === 'local' ? [] : buildSessionQueue(dueWords, newWords),
    sessionEntries: contentMode === 'local' ? buildSessionQueue(dueWords, newWords).map(toSessionEntry) : [],
    stats: freshStats
  }
}

async function updateRecord({ userId, word_id, collection, rating = 'good', word_order = 0 }) {
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

  if (Number(word_order)) {
    baseData.word_order = Number(word_order)
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

async function batchUpdateRecords({ userId, collection, records = [] }) {
  if (!userId || !collection || !Array.isArray(records) || !records.length) {
    return { ok: false, error: 'missing_params' }
  }

  const profileDoc = await readProfileDoc(userId)
  let lastNewOrder = Number(profileDoc?.last_new_order) || 0
  const results = []
  for (const record of records) {
    if (!record || !record.word_id) continue
    const result = await updateRecord({
      userId,
      collection,
      word_id: record.word_id,
      rating: record.rating || 'good',
      word_order: record.word_order || 0
    })
    if (record.session_type === 'new' && Number(record.word_order) > lastNewOrder) {
      lastNewOrder = Number(record.word_order)
    }
    results.push({
      word_id: record.word_id,
      ...result
    })
  }

  if (lastNewOrder !== (Number(profileDoc?.last_new_order) || 0)) {
    await db.collection('user_word_progress').doc(getProfileDocId(userId)).set({
      data: {
        doc_type: 'profile',
        user_id: userId,
        collection: profileDoc?.collection || collection,
        new_limit: Number(profileDoc?.new_limit) || DEFAULT_PROFILE.newLimit,
        review_limit: Number(profileDoc?.review_limit) || DEFAULT_PROFILE.reviewLimit,
        last_new_order: lastNewOrder,
        update_time: db.serverDate()
      }
    })
  }

  return {
    ok: true,
    processed: results.length,
    results
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

async function getFavorites({ userId, collection, skip = 0, limit = 20, contentMode = 'cloud' }) {
  if (!userId) return { words: [], hasMore: false }

  const favDocs = await db.collection('user_word_favorites')
    .where({ user_id: userId, collection })
    .orderBy('create_time', 'desc')
    .skip(skip)
    .limit(limit)
    .get()

  const ids = favDocs.data.map(item => item.word_id)
  if (!ids.length) return { words: [], hasMore: false }

  if (contentMode === 'local') {
    return {
      wordIds: ids,
      hasMore: favDocs.data.length >= limit
    }
  }

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
    const doc = await readProfileDoc(userId)
    return {
      profile: {
        ...DEFAULT_PROFILE,
        collection: doc?.collection || DEFAULT_PROFILE.collection,
        newLimit: Number(doc?.new_limit) || DEFAULT_PROFILE.newLimit,
        reviewLimit: Number(doc?.review_limit) || DEFAULT_PROFILE.reviewLimit,
        lastNewOrder: Number(doc?.last_new_order) || DEFAULT_PROFILE.lastNewOrder
      },
      hasProfile: !!doc
    }
  } catch (error) {
    return { profile: { ...DEFAULT_PROFILE }, hasProfile: false }
  }
}

async function saveUserProfile({ userId, payload }) {
  if (!userId || !payload) return { ok: false }
  const profileDoc = await readProfileDoc(userId)

  await db.collection('user_word_progress').doc(getProfileDocId(userId)).set({
    data: {
      doc_type: 'profile',
      user_id: userId,
      collection: payload.collection || DEFAULT_PROFILE.collection,
      new_limit: Number(payload.newLimit) || DEFAULT_PROFILE.newLimit,
      review_limit: Number(payload.reviewLimit) || DEFAULT_PROFILE.reviewLimit,
      last_new_order: Number(payload.lastNewOrder ?? profileDoc?.last_new_order) || DEFAULT_PROFILE.lastNewOrder,
      update_time: db.serverDate()
    }
  })

  return {
    ok: true,
    profile: {
      collection: payload.collection || DEFAULT_PROFILE.collection,
      newLimit: Number(payload.newLimit) || DEFAULT_PROFILE.newLimit,
      reviewLimit: Number(payload.reviewLimit) || DEFAULT_PROFILE.reviewLimit,
      lastNewOrder: Number(payload.lastNewOrder ?? profileDoc?.last_new_order) || DEFAULT_PROFILE.lastNewOrder
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
      case 'batchUpdateRecords':
        return await batchUpdateRecords(event)
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
