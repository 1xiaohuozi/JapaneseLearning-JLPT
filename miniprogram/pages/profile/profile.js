Page({
  data: {
    userId: '',
    userDisplayId: '未登录',
    isLoggedIn: false,
    daysToNextJlpt: '',
    examMonthLabel: ''
  },

  onLoad() {},

  onShow() {
    const userId = wx.getStorageSync('userId') || ''
    const isLoggedIn = !!userId

    this.setData({
      userId,
      isLoggedIn,
      userDisplayId: isLoggedIn ? this.formatUserId(userId) : '未登录'
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
