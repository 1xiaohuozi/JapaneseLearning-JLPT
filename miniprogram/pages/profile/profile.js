const { getDailySummary } = require('../../utils/retention')
const { LEVELS, TIME_OPTIONS, getStudyPlan, saveStudyPlan, getPlanCopy } = require('../../utils/studyPlan')

Page({
  data: {
    userId: '',
    userDisplayId: '未登录',
    isLoggedIn: false,
    daysToNextJlpt: '',
    examMonthLabel: '',
    dailySummary: {
      streak: 0,
      completedCount: 0,
      totalCount: 3,
      progressPercent: 0,
      taskList: []
    },
    studyPlan: getStudyPlan(),
    planCopy: getPlanCopy(),
    showPlanSetup: false,
    levelOptions: LEVELS.map(level => ({ key: level, label: level })),
    timeOptions: TIME_OPTIONS,
    planDraft: {
      targetLevel: 'N2',
      dailyMinutes: 15,
      takesJlpt: true
    }
  },

  onLoad() {},

  onShow() {
    const userId = wx.getStorageSync('userId') || ''
    const isLoggedIn = !!userId

    const studyPlan = getStudyPlan()
    this.setData({
      userId,
      isLoggedIn,
      userDisplayId: isLoggedIn ? this.formatUserId(userId) : '未登录',
      dailySummary: getDailySummary(),
      studyPlan,
      planCopy: getPlanCopy(studyPlan),
      showPlanSetup: !studyPlan.setupDone,
      planDraft: {
        targetLevel: studyPlan.targetLevel,
        dailyMinutes: studyPlan.dailyMinutes,
        takesJlpt: studyPlan.takesJlpt
      }
    })

    this.calcDaysToNextJlpt()
  },

  onPullDownRefresh() {
    this.onShow()
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 300)
  },

  formatUserId(userId) {
    if (!userId) return '未登录'
    if (userId.length <= 16) return userId
    return `${userId.slice(0, 8)}...${userId.slice(-4)}`
  },

  calcDaysToNextJlpt() {
    const today = new Date()
    const year = today.getFullYear()

    const getFirstSunday = (y, m) => {
      const d = new Date(y, m, 1)
      const day = d.getDay()
      const offset = day === 0 ? 0 : 7 - day
      d.setDate(1 + offset)
      return d
    }

    const julyExam = getFirstSunday(year, 6)
    const decExam = getFirstSunday(year, 11)

    let nextExam = julyExam
    let examMonthLabel = '7月'
    if (today > julyExam && today <= decExam) {
      nextExam = decExam
      examMonthLabel = '12月'
    } else if (today > decExam) {
      nextExam = getFirstSunday(year + 1, 6)
      examMonthLabel = `${year + 1}年7月`
    }

    const diffTime = nextExam - today
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    this.setData({
      daysToNextJlpt: days,
      examMonthLabel
    })
  },

  navigateToMemory() {
    wx.navigateTo({ url: '/pages/profile/memory/memory' })
  },

  openPlanSetup() {
    const plan = this.data.studyPlan
    this.setData({
      'planDraft.targetLevel': plan.targetLevel,
      'planDraft.dailyMinutes': plan.dailyMinutes,
      'planDraft.takesJlpt': plan.takesJlpt
    }, () => {
      this.setData({ showPlanSetup: true })
    })
  },

  closePlanSetup() {
    if (!this.data.studyPlan.setupDone) return
    this.setData({ showPlanSetup: false })
  },

  choosePlanLevel(e) {
    this.setData({ 'planDraft.targetLevel': e.currentTarget.dataset.level })
  },

  choosePlanTime(e) {
    this.setData({ 'planDraft.dailyMinutes': Number(e.currentTarget.dataset.minutes) })
  },

  choosePlanJlpt(e) {
    this.setData({ 'planDraft.takesJlpt': e.currentTarget.dataset.value === 'true' })
  },

  async savePlanSetup() {
    const studyPlan = saveStudyPlan(this.data.planDraft)
    await this.syncPlanToWordProfile(studyPlan)
    this.setData({
      studyPlan,
      planCopy: getPlanCopy(studyPlan),
      dailySummary: getDailySummary(),
      showPlanSetup: false
    })
    this.showPlanStartActions()
  },

  showPlanStartActions() {
    wx.showActionSheet({
      alertText: '今日计划已生成，要从哪里开始？',
      itemList: ['开始背单词', '先刷语法', '去听力跟读'],
      success: res => {
        if (res.tapIndex === 0) {
          wx.switchTab({ url: '/pages/word-learning/word-learning' })
          return
        }
        if (res.tapIndex === 1) {
          wx.switchTab({ url: '/pages/grammar/deepstudy/deepstudy' })
          return
        }
        wx.switchTab({ url: '/pages/speaking/speaking' })
      }
    })
  },

  async syncPlanToWordProfile(studyPlan) {
    const userId = wx.getStorageSync('userId') || ''
    if (!userId) return

    const collectionMap = {
      N1: 'n1_words',
      N2: 'n2_words',
      N3: 'n3_words',
      'N4/N5': 'n4n5_words'
    }

    try {
      await wx.cloud.callFunction({
        name: 'lafService',
        data: {
          action: 'saveUserProfile',
          userId,
          payload: {
            collection: collectionMap[studyPlan.targetLevel] || 'n2_words',
            newLimit: studyPlan.daily.newLimit,
            reviewLimit: studyPlan.daily.reviewLimit
          }
        }
      })
    } catch (error) {
      console.error('syncPlanToWordProfile failed', error)
    }
  },

  goToDailyTask(e) {
    const key = e.currentTarget.dataset.key
    const task = (this.data.dailySummary.taskList || []).find(item => item.key === key)
    if (!task || !task.route) return

    if (task.tab) {
      wx.switchTab({ url: task.route })
      return
    }

    wx.navigateTo({ url: task.route })
  },

  handleLogin() {
    wx.navigateTo({ url: '/pages/profile/login/login' })
  },

  navigateToAbabWords() {
    wx.navigateTo({ url: '/pages/profile/abab/abab' })
  },

  navigateToJlptCodes() {
    wx.navigateTo({ url: '/pages/profile/jlptcodes/jlptcodes' })
  },

  handleLogout() {
    wx.showModal({
      title: '确认退出登录？',
      content: '退出后会清除本地账号信息，需要重新登录才能继续同步学习记录。',
      success: res => {
        if (res.confirm) {
          wx.clearStorageSync()
          getApp().globalData.userInfo = null
          getApp().globalData.userId = null
          this.setData({
            userId: '',
            isLoggedIn: false,
            userDisplayId: '未登录'
          })
          wx.showToast({ title: '已退出登录', icon: 'success' })
        }
      }
    })
  },

  onShareAppMessage() {
    return {
      title: '日语备考通 - 更轻松地管理你的学习节奏',
      path: '/pages/grammar/grammar',
      imageUrl: '../../images/蓝宝书.png'
    }
  }
})
