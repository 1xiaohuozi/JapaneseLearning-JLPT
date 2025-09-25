Page({
  data: {
    userId: '',
    totalReviewCount: 0,
    studyTotal: 0,
    speakingTotal: 0,
    wordTotal: 0,             // ✅ 单词熟练度总和
    displayedStudyCount: 0,
    displayedSpeakingCount: 0,
    displayedWordCount: 0,    // ✅ 单词展示用
    displayedTotalCount: 0,
    daysToNextJlpt: ''
  },

  onLoad() {},

  onShow() {
    const userId = wx.getStorageSync('userId') || '未登录'
    this.setData({ userId, totalReviewCount: "加载中" })
    if (userId !== '未登录') {
      this.getTotalReviewCount(userId)
    }
    this.calcDaysToNextJlpt()
  },

  // 计算距离最近 JLPT 天数
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

    const julyExam = getFirstSunday(year, 6)   // 7月
    const decExam = getFirstSunday(year, 11)   // 12月

    let nextExam
    if (today <= julyExam) {
      nextExam = julyExam
    } else if (today <= decExam) {
      nextExam = decExam
    } else {
      nextExam = getFirstSunday(year + 1, 6)   // 下一年7月
    }

    const diffTime = nextExam - today
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    this.setData({ daysToNextJlpt: days })
  },

  // 获取总学习次数（语法 + 听力 + 单词熟练度）
  async getTotalReviewCount(userId) {
    const db = wx.cloud.database()
    const $ = db.command.aggregate

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

      // 3️⃣ 单词统计（proficiency 总和）
      const wordRes = await db.collection('user_word_records')
        .aggregate()
        .match({ user_id: userId })
        .group({ _id: null, total: $.sum('$proficiency') })
        .end()
      const wordTotal = wordRes.list[0]?.total || 0

      // 4️⃣ 总和
      const totalReviewCount = studyTotal + speakingTotal + wordTotal

      // 5️⃣ 更新数据并执行动画效果
      this.setData({ studyTotal, speakingTotal, wordTotal, totalReviewCount })
      this.animateCount(studyTotal, 'displayedStudyCount')
      this.animateCount(speakingTotal, 'displayedSpeakingCount')
      this.animateCount(wordTotal, 'displayedWordCount')
      this.animateCount(totalReviewCount, 'displayedTotalCount')

    } catch (err) {
      console.error('获取学习次数失败', err)
      wx.showToast({ title: '加载学习次数失败', icon: 'none' })
    }
  },

  // 动态数字动画
  animateCount(target, key, duration = 700) {
    const stepTime = 30
    const steps = Math.ceil(duration / stepTime)
    let current = 0
    const increment = target / steps

    const timer = setInterval(() => {
      current += increment
      if (current >= target) {
        current = target
        clearInterval(timer)
      }
      this.setData({ [key]: Math.floor(current) })
    }, stepTime)
  },

  // 跳转方法
  navigateToMemory() {
    wx.navigateTo({ url: '/pages/profile/memory/memory' })
  },

  handleLogin() {
    wx.navigateTo({ url: '/pages/profile/login/login' })
  },

  navigateToFavorites() {
    wx.navigateTo({ url: '/pages/grammar/favorites/favorites' })
  },

  navigateToAbabWords() {
    wx.navigateTo({ url: '/pages/profile/abab/abab' })
  },

  navigateToJlptCodes() {
    wx.navigateTo({ url: '/pages/profile/jlptcodes/jlptcodes' })
  },

  navigateToLeaderboard() {
    wx.navigateTo({ url: '/pages/profile/leaderboard/leaderboard' })
  },

  handleLogout() {
    wx.showModal({
      title: '确认退出登录？',
      content: '退出后将清除本地学习记录和账号信息。',
      success: res => {
        if (res.confirm) {
          wx.clearStorageSync()
          getApp().globalData.userInfo = null
          getApp().globalData.userId = null
          this.setData({ userId: '未登录' })
          wx.showToast({ title: '已退出登录', icon: 'success' })
        }
      }
    })
  },

  // 分享
  onShareAppMessage() {
    return {
      title: '日语N2备考通速记 - 高效备考工具',
      path: '/pages/grammar/grammar',
      imageUrl: '../../images/蓝宝书.png'
    }
  }
})
