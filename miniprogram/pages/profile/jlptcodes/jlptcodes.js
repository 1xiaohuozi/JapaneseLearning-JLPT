const db = wx.cloud.database()
const scoreCollection = db.collection('user_jlptscores')

const LEVEL_CONFIGS = {
  N1: {
    title: 'JLPT N1',
    totalScore: 180,
    overallPass: 100,
    sections: [
      { key: 'language', title: '语言知识', subtitle: '文字词汇 + 语法', scoreMax: 60, passMark: 19, placeholder: '例如 38/55' },
      { key: 'reading', title: '阅读', subtitle: '长文与信息检索', scoreMax: 60, passMark: 19, placeholder: '例如 18/25' },
      { key: 'listening', title: '听力', subtitle: '课题理解 + 即时应答', scoreMax: 60, passMark: 19, placeholder: '例如 22/30' }
    ]
  },
  N2: {
    title: 'JLPT N2',
    totalScore: 180,
    overallPass: 90,
    sections: [
      { key: 'language', title: '语言知识', subtitle: '文字词汇 + 语法', scoreMax: 60, passMark: 19, placeholder: '例如 34/47' },
      { key: 'reading', title: '阅读', subtitle: '信息理解与长文', scoreMax: 60, passMark: 19, placeholder: '例如 20/25' },
      { key: 'listening', title: '听力', subtitle: '课题理解 + 综合理解', scoreMax: 60, passMark: 19, placeholder: '例如 21/30' }
    ]
  },
  N3: {
    title: 'JLPT N3',
    totalScore: 180,
    overallPass: 95,
    sections: [
      { key: 'language', title: '语言知识', subtitle: '文字词汇 + 语法', scoreMax: 60, passMark: 19, placeholder: '例如 36/48' },
      { key: 'reading', title: '阅读', subtitle: '中篇与长文阅读', scoreMax: 60, passMark: 19, placeholder: '例如 18/24' },
      { key: 'listening', title: '听力', subtitle: '对话与概要理解', scoreMax: 60, passMark: 19, placeholder: '例如 20/28' }
    ]
  },
  N4: {
    title: 'JLPT N4',
    totalScore: 180,
    overallPass: 90,
    sections: [
      { key: 'languageReading', title: '语言知识 + 阅读', subtitle: '词汇语法与基础阅读', scoreMax: 120, passMark: 38, placeholder: '例如 52/80' },
      { key: 'listening', title: '听力', subtitle: '场景理解与对话理解', scoreMax: 60, passMark: 19, placeholder: '例如 18/28' }
    ]
  },
  N5: {
    title: 'JLPT N5',
    totalScore: 180,
    overallPass: 80,
    sections: [
      { key: 'languageReading', title: '语言知识 + 阅读', subtitle: '基础词汇语法与短文', scoreMax: 120, passMark: 38, placeholder: '例如 48/80' },
      { key: 'listening', title: '听力', subtitle: '短对话与简短说明', scoreMax: 60, passMark: 19, placeholder: '例如 17/28' }
    ]
  }
}

function getTodayString() {
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  return `${y}/${m}/${d}`
}

function createSectionInputs(level) {
  const config = LEVEL_CONFIGS[level]
  return (config.sections || []).map(section => ({
    key: section.key,
    total: '',
    correct: ''
  }))
}

function ratioToGrade(ratio) {
  if (ratio >= 0.67) return 'A'
  if (ratio >= 0.34) return 'B'
  return 'C'
}

Page({
  data: {
    currentLevel: 'N2',
    levelTabs: Object.keys(LEVEL_CONFIGS),
    levelConfig: LEVEL_CONFIGS.N2,
    sectionInputs: createSectionInputs('N2'),
    result: {
      level: 'N2',
      total: 0,
      pass: false,
      date: getTodayString(),
      sectionScores: [],
      overallPass: 0,
      totalScore: 0
    },
    showPopup: false,
    showHistoryPopup: false,
    historyList: [],
    currentScoreData: null
  },

  onLoad() {
    this.loadHistory()
  },

  switchLevel(e) {
    const level = e.currentTarget.dataset.level
    if (!LEVEL_CONFIGS[level]) return

    this.setData({
      currentLevel: level,
      levelConfig: LEVEL_CONFIGS[level],
      sectionInputs: createSectionInputs(level),
      result: {
        level,
        total: 0,
        pass: false,
        date: getTodayString(),
        sectionScores: [],
        overallPass: LEVEL_CONFIGS[level].overallPass,
        totalScore: LEVEL_CONFIGS[level].totalScore
      }
    })
  },

  onInputTotal(e) {
    const index = Number(e.currentTarget.dataset.index)
    const value = e.detail.value.trim()
    const sectionInputs = this.data.sectionInputs.slice()
    sectionInputs[index].total = value
    this.setData({ sectionInputs })
  },

  onInputCorrect(e) {
    const index = Number(e.currentTarget.dataset.index)
    const value = e.detail.value.trim()
    const sectionInputs = this.data.sectionInputs.slice()
    sectionInputs[index].correct = value
    this.setData({ sectionInputs })
  },

  validateInputs() {
    const { sectionInputs, levelConfig } = this.data
    for (let i = 0; i < sectionInputs.length; i += 1) {
      const input = sectionInputs[i]
      const total = Number(input.total)
      const correct = Number(input.correct)
      const section = levelConfig.sections[i]

      if (!Number.isFinite(total) || total <= 0) {
        wx.showToast({ title: `${section.title} 的总题数无效`, icon: 'none' })
        return null
      }

      if (!Number.isFinite(correct) || correct < 0) {
        wx.showToast({ title: `${section.title} 的正确数无效`, icon: 'none' })
        return null
      }

      if (correct > total) {
        wx.showToast({ title: `${section.title} 的正确数不能大于总题数`, icon: 'none' })
        return null
      }
    }

    return sectionInputs.map(item => ({
      total: Number(item.total),
      correct: Number(item.correct)
    }))
  },

  calcScore() {
    const validated = this.validateInputs()
    if (!validated) return

    const { currentLevel, levelConfig } = this.data
    const sectionScores = levelConfig.sections.map((section, index) => {
      const total = validated[index].total
      const correct = validated[index].correct
      const ratio = total > 0 ? (correct / total) : 0
      const score = Math.round(ratio * section.scoreMax)
      return {
        key: section.key,
        title: section.title,
        subtitle: section.subtitle,
        total,
        correct,
        score,
        scoreMax: section.scoreMax,
        passMark: section.passMark,
        pass: score >= section.passMark,
        grade: ratioToGrade(ratio)
      }
    })

    const total = sectionScores.reduce((sum, item) => sum + item.score, 0)
    const pass = total >= levelConfig.overallPass && sectionScores.every(item => item.pass)

    const result = {
      level: currentLevel,
      total,
      pass,
      date: getTodayString(),
      sectionScores,
      overallPass: levelConfig.overallPass,
      totalScore: levelConfig.totalScore
    }

    this.setData({
      result,
      currentScoreData: {
        ...result,
        user_id: wx.getStorageSync('userId') || '',
        createTime: db.serverDate()
      },
      showPopup: true
    })

    this.saveScore()
  },

  async saveScore() {
    if (!this.data.currentScoreData) return

    try {
      await scoreCollection.add({
        data: this.data.currentScoreData
      })
      this.loadHistory()
    } catch (error) {
      console.error('save jlpt score failed', error)
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      })
    }
  },

  async loadHistory() {
    try {
      const userId = wx.getStorageSync('userId') || ''
      let query = scoreCollection.orderBy('createTime', 'desc').limit(20)
      if (userId) {
        query = scoreCollection.where({ user_id: userId }).orderBy('createTime', 'desc').limit(20)
      }
      const res = await query.get()
      this.setData({
        historyList: res.data || []
      })
    } catch (error) {
      console.error('load jlpt history failed', error)
    }
  },

  showHistory() {
    this.loadHistory()
    this.setData({ showHistoryPopup: true })
  },

  selectHistory(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    this.setData({
      result: item,
      showPopup: true,
      showHistoryPopup: false
    })
  },

  closePopup() {
    this.setData({ showPopup: false })
  },

  closeHistoryPopup() {
    this.setData({ showHistoryPopup: false })
  }
})
