const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    currentGrammar: null,
    currentProficiency: 0, // ⭐ 当前语法的熟练度星级
    isFavorite: false,
    loading: true,
    showDetail: false,
    allCompleted: false,
    currentTab: 'overview', // 默认选中
  },
  
  

  userId: "",
  grammarList: [],
  studyRecords: {},
  currentIndex: 0,

  onLoad() {
    this.userId = wx.getStorageSync('userId') || '';
  },

  onShow() {
    this.userId = wx.getStorageSync('userId') || '';
    if (!this.userId) {
      wx.showModal({
        title: '提示',
        content: '您尚未登录，是否前往登录页面？',
        success: res => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/profile/login/login' });
          } else {
            wx.navigateBack();
          }
        }
      });
      return;
    }
  
    if (Array.isArray(this.grammarList) && this.grammarList.length > 0 && this.currentIndex < this.grammarList.length) {
      const grammarId = this.grammarList[this.currentIndex].grammar_id;
      const record = this.studyRecords[grammarId] || {};
      
      this.setData({
        currentGrammar: this.grammarList[this.currentIndex],
        currentProficiency: record.proficiency || 0, // 确保有默认值0
        allCompleted: false,
        loading: false,
        showDetail: false
      });
      
      this.checkFavoriteStatus(grammarId);
    } else if (this.data.allCompleted) {
      this.setData({ loading: false });
    } else {
      this.loadGrammar();
    }
  },

  // 获取所有语法数据（分页获取）
  async getAllGrammarPoints() {
    const MAX_LIMIT = 20;
    const countRes = await db.collection('grammar_points').count();
    const total = countRes.total;
    const batchTimes = Math.ceil(total / MAX_LIMIT);
    const tasks = [];

    for (let i = 0; i < batchTimes; i++) {
      const promise = db.collection('grammar_points')
        .skip(i * MAX_LIMIT)
        .limit(MAX_LIMIT)
        .get();
      tasks.push(promise);
    }

    const results = await Promise.all(tasks);
    return results.flatMap(res => res.data);
  },

  async loadGrammar() {
    this.setData({ loading: true, isFavorite: false,allCompleted: false, currentGrammar: null, showDetail: false });
    wx.showLoading({ title: '加载语法中' });

    try {
      // 1. 获取所有语法（修改为分页）
      const allGrammar = await this.getAllGrammarPoints();
      if (allGrammar.length === 0) {
        wx.showToast({ title: '语法库为空', icon: 'none' });
        this.setData({ loading: false });
        wx.hideLoading();
        return;
      }

      // 2. 获取用户学习记录
      const userRecordsRes = await db.collection('user_study_records')
        .where({ user_id: this.userId })
        .get();
      const records = userRecordsRes.data;
      this.studyRecords = {};
      for (const rec of records) {
        this.studyRecords[rec.grammar_id] = rec;
      }

      const MAX_INTERVAL_DAYS = 30;
      const now = new Date();

      let reviewCandidates = [];
      let newCandidates = [];

      for (const g of allGrammar) {
        const rec = this.studyRecords[g.grammar_id];
        if (rec) {
          let proficiency = rec.proficiency || 0;
          let lastReview = rec.last_review ? new Date(rec.last_review) : null;
          let intervalDays = lastReview ? Math.floor((now - lastReview) / (1000 * 60 * 60 * 24)) : MAX_INTERVAL_DAYS;
          let weight = (MAX_INTERVAL_DAYS - intervalDays) * (5 - proficiency);
          weight = Math.max(0, weight);
          if (weight > 0) {
            reviewCandidates.push({ grammar: g, weight });
          }
        } else {
          newCandidates.push({ grammar: g, weight: 10 });
        }
      }

      reviewCandidates.sort((a, b) => b.weight - a.weight);

      for (let i = newCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newCandidates[i], newCandidates[j]] = [newCandidates[j], newCandidates[i]];
      }

      const mergedList = [];
      const maxLen = Math.max(reviewCandidates.length, newCandidates.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < reviewCandidates.length) mergedList.push(reviewCandidates[i].grammar);
        if (i < newCandidates.length) mergedList.push(newCandidates[i].grammar);
      }

      if (mergedList.length === 0) {
        this.setData({ allCompleted: true, loading: false, currentGrammar: null });
        this.grammarList = [];
        wx.hideLoading();
        return;
      }

      this.grammarList = mergedList;
      this.currentIndex = 0;
 // 获取第一条语法的熟练度
 const firstGrammar = this.grammarList[0];
 const grammarId = firstGrammar.grammar_id;
 const record = this.studyRecords[grammarId] || {};
      this.setData({
        currentGrammar: this.grammarList[this.currentIndex],
        currentProficiency: record.proficiency || 0, // 确保初始熟练度
        loading: false,
        showDetail: false,
        allCompleted: false
      });
      await this.checkFavoriteStatus(this.grammarList[this.currentIndex].grammar_id);
      wx.hideLoading();

    } catch (error) {
      console.error('加载语法失败', error);
      wx.showToast({ title: '加载失败，请重试', icon: 'error' });
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  async handleAnswer(e) {
    if (!this.userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (!this.data.currentGrammar) return;
  
    const known = e.currentTarget.dataset.known === 'true';
    const grammar_id = this.data.currentGrammar.grammar_id;
  
    wx.showLoading({ title: '更新进度中' });
  
    try {
      const recordRes = await db.collection('user_study_records')
        .where({ user_id: this.userId, grammar_id })
        .get();
  
      let newProficiency;
      if (recordRes.data.length === 0) {
        // 新记录
        newProficiency = known ? 1 : 0;
        await db.collection('user_study_records').add({
          data: {
            user_id: this.userId,
            grammar_id,
            proficiency: newProficiency,
            review_count: 1,
            study_time: db.serverDate(),
            last_review: db.serverDate()
          }
        });
      } else {
        // 更新记录
        const record = recordRes.data[0];
        newProficiency = known ? 
          Math.min(5, (record.proficiency || 0) + 1) : 
          Math.max(0, (record.proficiency || 0) - 1);
  
        await db.collection('user_study_records').doc(record._id).update({
          data: {
            proficiency: newProficiency,
            review_count: _.inc(1),
            last_review: db.serverDate()
          }
        });
      }
  
      // 更新本地记录
      this.studyRecords[grammar_id] = {
        ...(this.studyRecords[grammar_id] || {}),
        proficiency: newProficiency,
        last_review: new Date()
      };
  
      // 立即更新UI
      this.setData({
        currentProficiency: newProficiency,
        showDetail: true
      });
  
    } catch (error) {
      console.error('更新学习记录失败', error);
      wx.showToast({ title: '更新失败，请重试', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },

  async nextGrammar() {
    this.currentIndex++;
  
    if (this.currentIndex >= this.grammarList.length) {
      this.setData({ currentGrammar: null, allCompleted: true, showDetail: false });
      wx.showToast({ title: '已完成全部语法', icon: 'success' });
      return;
    }
  
    this.setData({ loading: true });
    // wx.showLoading({ title: '加载下一条' });
    try {
      const nextGrammar = this.grammarList[this.currentIndex];
      const grammarId = nextGrammar.grammar_id;
  
      let record = this.studyRecords[grammarId];
  
      // 若本地记录没有该语法的熟练度，尝试从数据库查询一次
      if (!record) {
        const res = await db.collection('user_study_records')
          .where({ user_id: this.userId, grammar_id: grammarId })
          .get();
        if (res.data.length > 0) {
          record = res.data[0];
          this.studyRecords[grammarId] = record; // 更新本地缓存
        } else {
          record = { proficiency: 0 };
        }
      }
  
      this.setData({
        currentGrammar: nextGrammar,
        currentProficiency: record.proficiency || 0,
        showDetail: false,
        loading: false
      });
  
      await this.checkFavoriteStatus(grammarId);
    } catch (error) {
      console.error('加载下一条语法失败', error);
      wx.showToast({ title: '加载失败', icon: 'error' });
      this.setData({ loading: false });
    }finally {
    wx.hideLoading(); // 不论成功或失败都关闭 loading 弹窗
  }
  },  
  async resetStudy() {
    if (!this.userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '重置复习中' });

    try {
      const userRecordsRes = await db.collection('user_study_records')
        .where({ user_id: this.userId })
        .get();

      const recordIds = userRecordsRes.data.map(r => r._id);

      const batchDelete = async (ids) => {
        for (let id of ids) {
          await db.collection('user_study_records').doc(id).remove();
        }
      };

      await batchDelete(recordIds);

      this.grammarList = [];
      this.currentIndex = 0;
      this.studyRecords = {};

      wx.showToast({ title: '已重置' });
      this.loadGrammar();
    } catch (error) {
      console.error('重置失败', error);
      wx.showToast({ title: '重置失败', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },
  async checkFavoriteStatus(grammar_id) {
    if (!this.userId || !grammar_id) {
      this.setData({ isFavorite: false });
      return;
    }
    
    try {
      const res = await db.collection('user_favorites')
        .where({ user_id: this.userId, grammar_id })
        .count();
      this.setData({ isFavorite: res.total > 0 });
    } catch (error) {
      console.error('检查收藏状态失败', error);
      this.setData({ isFavorite: false });
    }
  },
  async toggleFavorite() {
    if (!this.userId || !this.data.currentGrammar) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
  
    const grammar_id = this.data.currentGrammar.grammar_id;
    
    wx.showLoading({ title: '处理中' });
    
    try {
      const res = await db.collection('user_favorites')
        .where({ user_id: this.userId, grammar_id })
        .get();
    
      if (res.data.length > 0) {
        await db.collection('user_favorites').doc(res.data[0]._id).remove();
        this.setData({ isFavorite: false });
        wx.showToast({ title: '已取消收藏', icon: 'none' });
      } else {
        await db.collection('user_favorites').add({
          data: {
            user_id: this.userId,
            grammar_id,
            create_time: db.serverDate()
          }
        });
        this.setData({ isFavorite: true });
        wx.showToast({ title: '已收藏', icon: 'success' });
      }
    } catch (error) {
      console.error('收藏操作失败', error);
      wx.showToast({ title: '操作失败', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },
  onShareAppMessage() {
    return {
      title: '日语N2备考通速记 - 高效备考工具',
      path: '/pages/grammar/grammar',
      imageUrl: '../../images/蓝宝书.png' // 准备一张分享图片
    }
  },
  // 跳转到语法通览页面
goToOverview() {
  wx.navigateTo({
    url: '/pages/grammar/grammar'
  });
},

// 跳转到语法收藏页面
goToFavorites() {
  wx.navigateTo({
    url: '/pages/grammar/favorites/favorites'
  });
},
switchTab(e) {
  const tab = e.currentTarget.dataset.tab;
  this.setData({ currentTab: tab });
  if(tab==='overview'){
    this.goToOverview();
  } else {
    this.goToFavorites();
  }
}
    
});
