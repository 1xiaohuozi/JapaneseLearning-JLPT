function normalizeUserId(userId = '') {
  return String(userId || '').trim()
}

function maskUserId(userId = '') {
  const normalized = normalizeUserId(userId)
  if (!normalized) return '未登录用户'
  if (normalized.length <= 8) return `${normalized}***`
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`
}

function decorateUser(entry, currentUserId) {
  if (!entry) return null
  const normalizedCurrent = normalizeUserId(currentUserId)
  const normalizedEntry = normalizeUserId(entry.userId)

  return {
    ...entry,
    userId: normalizedEntry,
    rank: Number(entry.rank) || 0,
    grammarScore: Number(entry.grammarScore) || 0,
    listeningScore: Number(entry.listeningScore) || 0,
    wordScore: Number(entry.wordScore) || 0,
    totalScore: Number(entry.totalScore) || 0,
    isSelf: normalizedEntry === normalizedCurrent,
    displayName: normalizedEntry === normalizedCurrent ? '我自己' : maskUserId(normalizedEntry),
    badgeText: entry.rank === 1 ? '冠军' : entry.rank === 2 ? '亚军' : entry.rank === 3 ? '季军' : ''
  }
}

Page({
  data: {
    loading: true,
    currentUserId: '',
    totalUsers: 0,
    myRank: null,
    topThree: [],
    restList: [],
    aroundMe: []
  },

  async onLoad() {
    await this.resolveCurrentUser()
    await this.loadLeaderboard()
  },

  async onShow() {
    const previousUserId = this.data.currentUserId
    await this.resolveCurrentUser()
    if (normalizeUserId(previousUserId) !== normalizeUserId(this.data.currentUserId)) {
      await this.loadLeaderboard()
    }
  },

  async onPullDownRefresh() {
    await this.resolveCurrentUser()
    await this.loadLeaderboard()
    wx.stopPullDownRefresh()
  },

  async resolveCurrentUser() {
    const app = getApp()
    let userId = wx.getStorageSync('userId') || ''

    if (!userId && app && typeof app.getUserId === 'function') {
      try {
        userId = await app.getUserId()
      } catch (error) {
        userId = ''
      }
    }

    userId = normalizeUserId(userId)
    if (userId) {
      wx.setStorageSync('userId', userId)
    }

    this.setData({ currentUserId: userId })
  },

  async loadLeaderboard() {
    this.setData({ loading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getLeaderboard',
        data: {
          limit: 50,
          currentUserId: this.data.currentUserId
        }
      })

      if (!res.result || !res.result.success) {
        throw new Error(res.result?.error || 'load_failed')
      }

      const leaderboard = (res.result.leaderboard || []).map(item => decorateUser(item, this.data.currentUserId))
      const myRank = decorateUser(res.result.currentUser, this.data.currentUserId)
      const aroundMe = (res.result.aroundMe || [])
        .map(item => decorateUser(item, this.data.currentUserId))
        .filter(item => !leaderboard.some(top => normalizeUserId(top.userId) === normalizeUserId(item.userId)))

      this.setData({
        loading: false,
        totalUsers: Number(res.result.totalUsers) || 0,
        myRank,
        topThree: leaderboard.slice(0, 3),
        restList: leaderboard.slice(3),
        aroundMe
      })
    } catch (error) {
      console.error('loadLeaderboard failed', error)
      this.setData({
        loading: false,
        totalUsers: 0,
        myRank: null,
        topThree: [],
        restList: [],
        aroundMe: []
      })
      wx.showToast({
        title: '加载排行榜失败',
        icon: 'none'
      })
    }
  }
})
