
// app.js
App({
  globalData: {
    userInfo: null,
    userId: null
  },
  
  onLaunch() {
    // 初始化云开发
    wx.cloud.init({
      env: 'zyzl-3gawcivd998e58ad', // 在云开发控制台获取
      traceUser: true
    })
    
    // 尝试从缓存加载登录状态
    const userInfo = wx.getStorageSync('userInfo')
    const userId = wx.getStorageSync('userId')
    if (userInfo && userId) {
      this.globalData.userInfo = userInfo
      this.globalData.userId = userId
    }
  },
  
  // 统一获取用户ID的方法
  async getUserId() {
    if (this.globalData.userId) {
      return this.globalData.userId
    }
    
    try {
      const { openId } = await wx.cloud.getCloudIdentity()
      return openId || 'temp_'+Date.now()
    } catch (err) {
      return 'temp_'+Date.now()
    }
  }
})