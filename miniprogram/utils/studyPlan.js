const STORAGE_KEY = 'study_plan'

const LEVELS = ['N1', 'N2', 'N3', 'N4/N5']
const TIME_OPTIONS = [
  { minutes: 5, label: '5 分钟', newLimit: 8, reviewLimit: 20, grammarLimit: 5, listeningLimit: 1 },
  { minutes: 15, label: '15 分钟', newLimit: 20, reviewLimit: 40, grammarLimit: 10, listeningLimit: 1 },
  { minutes: 30, label: '30 分钟', newLimit: 35, reviewLimit: 80, grammarLimit: 15, listeningLimit: 2 }
]

const DEFAULT_PLAN = {
  targetLevel: 'N2',
  dailyMinutes: 15,
  takesJlpt: true,
  setupDone: false,
  updatedAt: 0
}

function getTimeOption(minutes) {
  return TIME_OPTIONS.find(item => item.minutes === Number(minutes)) || TIME_OPTIONS[1]
}

function normalizePlan(plan = {}) {
  const targetLevel = LEVELS.includes(plan.targetLevel) ? plan.targetLevel : DEFAULT_PLAN.targetLevel
  const option = getTimeOption(plan.dailyMinutes)

  return {
    ...DEFAULT_PLAN,
    ...plan,
    targetLevel,
    dailyMinutes: option.minutes,
    takesJlpt: typeof plan.takesJlpt === 'boolean' ? plan.takesJlpt : DEFAULT_PLAN.takesJlpt,
    daily: {
      newLimit: option.newLimit,
      reviewLimit: option.reviewLimit,
      grammarLimit: option.grammarLimit,
      listeningLimit: option.listeningLimit,
      estimatedMinutes: option.minutes
    }
  }
}

function getStudyPlan() {
  return normalizePlan(wx.getStorageSync(STORAGE_KEY) || {})
}

function saveStudyPlan(plan) {
  const normalized = normalizePlan({
    ...plan,
    setupDone: true,
    updatedAt: Date.now()
  })
  wx.setStorageSync(STORAGE_KEY, normalized)
  syncWordSettings(normalized)
  syncGrammarSettings(normalized)
  return normalized
}

function syncWordSettings(plan = getStudyPlan()) {
  const current = wx.getStorageSync('word_learning_settings') || {}
  const levels = ['N1', 'N2', 'N3', 'N4/N5']
  const levelIndex = Math.max(0, levels.indexOf(plan.targetLevel))

  wx.setStorageSync('word_learning_settings', {
    ...current,
    levelIndex,
    newLimit: plan.daily.newLimit,
    reviewLimit: plan.daily.reviewLimit,
    planSource: 'study_plan',
    planUpdatedAt: plan.updatedAt || Date.now()
  })
}

function syncGrammarSettings(plan = getStudyPlan()) {
  const current = wx.getStorageSync('grammar_learning_settings') || {}
  const collectionMap = {
    N1: 'n1_grammar',
    N2: 'n2_grammar',
    N3: 'n3_grammar',
    'N4/N5': 'n4n5_grammar'
  }

  wx.setStorageSync('grammar_learning_settings', {
    ...current,
    collectionKey: collectionMap[plan.targetLevel] || 'n2_grammar'
  })
}

function getPlanCopy(plan = getStudyPlan()) {
  const option = getTimeOption(plan.dailyMinutes)
  return {
    title: `${plan.targetLevel} · 每天 ${option.label}`,
    subtitle: plan.takesJlpt ? '按 JLPT 备考节奏推进' : '按日常积累节奏推进',
    dailyText: `新词 ${plan.daily.newLimit} · 复习 ${plan.daily.reviewLimit} · 语法 ${plan.daily.grammarLimit} · 听力 ${plan.daily.listeningLimit} 节`
  }
}

module.exports = {
  LEVELS,
  TIME_OPTIONS,
  getStudyPlan,
  saveStudyPlan,
  syncWordSettings,
  syncGrammarSettings,
  getPlanCopy
}
