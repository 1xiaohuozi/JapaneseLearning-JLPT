const { migrateGuestProgressToUser } = require('../../../utils/retention')

Page({
  async onLoginTap() {
    try {
      // 1. 获取用户信息
      const { userInfo } = await new Promise((resolve, reject) => {
        wx.getUserProfile({
          desc: '用于保存学习记录',
          success: resolve,
          fail: reject
        })
      })

      wx.showLoading({ title: '登录中...' })

      // 2. 调用云函数获取 openid
      const res = await wx.cloud.callFunction({
        name: 'getOpenId'
      })
      const openId = res.result.openid

      // 3. 保存登录状态
      getApp().globalData.userInfo = userInfo
      getApp().globalData.userId = openId || 'temp_' + Date.now()
      wx.setStorageSync('userInfo', userInfo)
      wx.setStorageSync('userId', getApp().globalData.userId)
      migrateGuestProgressToUser(getApp().globalData.userId)

      // 4. 跳转页面
      const redirectUrl = wx.getStorageSync('login_redirect_url') || '/pages/profile/profile'
      wx.removeStorageSync('login_redirect_url')
      wx.switchTab({ url: redirectUrl })
      wx.showToast({
        title: '登录成功',
        icon: 'success'
      })
    } catch (err) {
      console.error('登录失败:', err)
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
    }
  }
})
