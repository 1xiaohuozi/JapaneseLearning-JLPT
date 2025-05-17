Page({
  data: {
    userId: ''
  },

  onLoad() {

  },
  onShow() {
    const userId = wx.getStorageSync('userId') || '未登录'
    this.setData({ userId })
  },
  handleFeedback() {
    wx.showModal({
      title: '反馈',
      content: '请联系开发者邮箱：youremail@example.com',
      showCancel: false
    })
  },

  handleLogin() {
    wx.navigateTo({
      url: '/pages/login/login' // 替换为你的登录页路径
    })
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
  
          // 更新页面状态为未登录
          this.setData({
            userId: '未登录'
          })
  
          wx.showToast({
            title: '已退出登录',
            icon: 'success'
          })
        }
      }
    })
  }
  
})
