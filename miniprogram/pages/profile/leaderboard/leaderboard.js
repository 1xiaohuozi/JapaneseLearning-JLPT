Page({
  data: {
    leaderboardTop10: [],
    currentUser: '',
    currentUserRank: 0 // 当前用户排名
  },

  onLoad() {
    const userId = wx.getStorageSync('userId') || '未登录';
    this.setData({ currentUser: userId });
    this.loadLeaderboard();
  },

  // 获取排行榜前10名
  async loadLeaderboard() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getLeaderboard'
      });
      console.log('排行榜原始数据', res.result.leaderboard);

      if (res.result.success) {
        const fullLeaderboard = res.result.leaderboard || [];

        // 标记前10名
        const top10 = fullLeaderboard.slice(0, 10).map((item, index) => {
          const study = item.studyTotal || 0;
          const speaking = item.speakingTotal || 0;
          const word = item.wordTotal || 0; // ✅ 新增
          return {
            ...item,
            userIdMasked: item.userId ? item.userId.slice(0, 9) + '***' : '***',
            totalCount: study + speaking + word,
            studyTotal: study,
            speakingTotal: speaking,
            wordTotal: word
          };
        });

        // 查找当前用户排名
        const currentUserIndex = fullLeaderboard.findIndex(item => item.userId === this.data.currentUser);
        this.setData({
          leaderboardTop10: top10,
          currentUserRank: currentUserIndex >= 0 ? currentUserIndex + 1 : 0
        });

      } else {
        wx.showToast({ title: '加载排行榜失败', icon: 'none' });
      }
    } catch (err) {
      console.error('加载排行榜失败', err);
      wx.showToast({ title: '加载排行榜失败', icon: 'none' });
    }
  }
});
