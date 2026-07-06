const STORAGE_KEY = 'daily_learning_retention'
const { getStudyPlan } = require('./studyPlan')

const TASKS = {
  word: {
    title: '单词复习',
    desc: '完成今日单词任务',
    route: '/pages/word-learning/word-learning',
    tab: true
  },
  grammar: {
    title: '语法巩固',
    desc: '完成一轮语法深度学习',
    route: '/pages/grammar/deepstudy/deepstudy',
    tab: true
  },
  listening: {
    title: '听力跟读',
    desc: '完整听完 1 个章节',
    route: '/pages/speaking/speaking',
    tab: true
  }
}

function getUserKey() {
  return wx.getStorageSync('userId') || 'guest'
}

function getDateKey(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function readStore() {
  return wx.getStorageSync(STORAGE_KEY) || {}
}

function writeStore(store) {
  wx.setStorageSync(STORAGE_KEY, store)
}

function mergeTaskRecord(baseTask = {}, guestTask = {}) {
  const baseIds = Array.isArray(baseTask.completedIds) ? baseTask.completedIds : []
  const guestIds = Array.isArray(guestTask.completedIds) ? guestTask.completedIds : []
  const completedIds = Array.from(new Set(baseIds.concat(guestIds)))
  const baseCount = Number(baseTask.count) || 0
  const guestCount = Number(guestTask.count) || 0

  return {
    ...baseTask,
    ...guestTask,
    completed: !!baseTask.completed || !!guestTask.completed,
    count: completedIds.length ? completedIds.length : Math.max(baseCount, guestCount),
    completedIds,
    detail: guestTask.detail || baseTask.detail || '',
    lastPayload: guestTask.lastPayload || baseTask.lastPayload || null,
    completedAt: Math.max(Number(baseTask.completedAt) || 0, Number(guestTask.completedAt) || 0)
  }
}

function getUserStore(store = readStore()) {
  const userKey = getUserKey()
  return {
    userKey,
    records: store[userKey] || {}
  }
}

function createEmptyRecord(dateKey = getDateKey()) {
  return {
    dateKey,
    updatedAt: Date.now(),
    tasks: {
      word: { completed: false, count: 0 },
      grammar: { completed: false, count: 0 },
      listening: { completed: false, count: 0 }
    }
  }
}

function normalizeRecord(record, dateKey) {
  const base = createEmptyRecord(dateKey)
  return {
    ...base,
    ...(record || {}),
    tasks: {
      word: { ...base.tasks.word, ...(record?.tasks?.word || {}) },
      grammar: { ...base.tasks.grammar, ...(record?.tasks?.grammar || {}) },
      listening: { ...base.tasks.listening, ...(record?.tasks?.listening || {}) }
    }
  }
}

function isDayCompleted(record) {
  if (!record || !record.tasks) return false
  return Object.keys(TASKS).some(key => !!record.tasks[key]?.completed)
}

function getStreak(records) {
  let streak = 0
  for (let offset = 0; offset > -366; offset -= 1) {
    const dateKey = getDateKey(offset)
    if (!isDayCompleted(records[dateKey])) break
    streak += 1
  }
  return streak
}

function getDailySummary() {
  const plan = getStudyPlan()
  const store = readStore()
  const { records } = getUserStore(store)
  const todayKey = getDateKey()
  const today = normalizeRecord(records[todayKey], todayKey)
  const planDesc = {
    word: `新词 ${plan.daily.newLimit} · 复习 ${plan.daily.reviewLimit}`,
    grammar: `完成 ${plan.daily.grammarLimit} 条语法`,
    listening: `完成 ${plan.daily.listeningLimit} 个章节`
  }
  const taskList = Object.keys(TASKS).map(key => ({
    key,
    ...TASKS[key],
    desc: planDesc[key] || TASKS[key].desc,
    completed: !!today.tasks[key].completed,
    count: Number(today.tasks[key].count) || 0,
    detail: today.tasks[key].detail || ''
  }))
  const completedCount = taskList.filter(item => item.completed).length

  return {
    dateKey: todayKey,
    streak: getStreak(records),
    completedCount,
    totalCount: taskList.length,
    progressPercent: Math.round((completedCount / taskList.length) * 100),
    allCompleted: completedCount === taskList.length,
    taskList
  }
}

function getNextTaskSuggestion(completedKey = '') {
  const summary = getDailySummary()
  const remaining = (summary.taskList || []).filter(item => !item.completed && item.key !== completedKey)
  const priority = {
    word: ['grammar', 'listening'],
    grammar: ['listening', 'word'],
    listening: ['word', 'grammar']
  }[completedKey] || ['word', 'grammar', 'listening']

  const task = priority
    .map(key => remaining.find(item => item.key === key))
    .find(Boolean) || remaining[0] || null

  if (!task) {
    return {
      hasNext: false,
      summary,
      label: '今日任务都完成了，回学习台',
      task: null
    }
  }

  return {
    hasNext: true,
    summary,
    task,
    label: `继续完成：${task.title}`
  }
}

function markTaskCompleted(taskKey, detail = {}) {
  if (!TASKS[taskKey]) return getDailySummary()

  const store = readStore()
  const { userKey, records } = getUserStore(store)
  const todayKey = getDateKey()
  const today = normalizeRecord(records[todayKey], todayKey)
  const prevTask = today.tasks[taskKey] || { completed: false, count: 0 }
  let nextCount = (Number(prevTask.count) || 0) + 1
  const completedIds = Array.isArray(prevTask.completedIds) ? prevTask.completedIds.slice() : []

  if (detail.uniqueId) {
    if (completedIds.includes(detail.uniqueId)) {
      nextCount = Number(prevTask.count) || 0
    } else {
      completedIds.push(detail.uniqueId)
      nextCount = completedIds.length
    }
  }

  today.tasks[taskKey] = {
    ...prevTask,
    completed: true,
    count: nextCount,
    completedIds,
    detail: detail.text || prevTask.detail || '',
    lastPayload: detail,
    completedAt: Date.now()
  }
  today.updatedAt = Date.now()

  store[userKey] = {
    ...records,
    [todayKey]: today
  }
  writeStore(store)

  return getDailySummary()
}

function getTodayTask(taskKey) {
  const store = readStore()
  const { records } = getUserStore(store)
  const today = normalizeRecord(records[getDateKey()], getDateKey())
  return today.tasks[taskKey] || { completed: false, count: 0 }
}

function migrateGuestProgressToUser(userId) {
  if (!userId || userId === 'guest') return getDailySummary()

  const store = readStore()
  const guestRecords = store.guest || {}
  if (!Object.keys(guestRecords).length) return getDailySummary()

  const userRecords = store[userId] || {}
  Object.keys(guestRecords).forEach(dateKey => {
    const guestRecord = normalizeRecord(guestRecords[dateKey], dateKey)
    const userRecord = normalizeRecord(userRecords[dateKey], dateKey)

    Object.keys(TASKS).forEach(taskKey => {
      userRecord.tasks[taskKey] = mergeTaskRecord(userRecord.tasks[taskKey], guestRecord.tasks[taskKey])
    })
    userRecord.updatedAt = Math.max(Number(userRecord.updatedAt) || 0, Number(guestRecord.updatedAt) || 0, Date.now())
    userRecords[dateKey] = userRecord
  })

  store[userId] = userRecords
  delete store.guest
  writeStore(store)
  return getDailySummary()
}

module.exports = {
  TASKS,
  getDailySummary,
  getNextTaskSuggestion,
  getTodayTask,
  migrateGuestProgressToUser,
  markTaskCompleted
}
