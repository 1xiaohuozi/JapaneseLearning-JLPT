const db = wx.cloud.database();
const _ = db.command;

let grammarList = []; // 当前本轮待学习的语法id数组
let currentIndex = 0;

Page({
  data: {
    currentGrammar: null,   // 当前显示的语法详情
    loading: true,
    showDetail: false,      // 是否显示语法详细信息
    allCompleted: false     // 是否完成所有语法学习
  },

  userId: "",

  onLoad() {
    const storedUserId = wx.getStorageSync('userId');
    if (storedUserId) {
      this.userId = storedUserId;
    }
  },

  onShow() {
    if (!this.userId) {
      wx.showModal({
        title: '提示',
        content: '您尚未登录，是否前往登录页面？',
        success: res => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/login/login' });
          } else {
            wx.navigateBack();
          }
        }
      });
      return;
    }

    this.loadGrammar();
  },

  async loadGrammar() {
    this.setData({ loading: true, allCompleted: false, currentGrammar: null, showDetail: false });
    wx.showLoading({ title: '加载语法中' });

    try {
      // 获取所有语法id
      const allGrammarRes = await db.collection('grammar_points').get();
      const allIds = allGrammarRes.data.map(item => item.grammar_id);

      // 获取用户学习记录
      const userRecordsRes = await db.collection('user_study_records')
        .where({ user_id: this.userId })
        .get();

      // 挑选出用户熟练度低于4的，或者还没学过的
      const learnedIds = userRecordsRes.data.map(item => item.grammar_id);
      const lowProficiencyIds = userRecordsRes.data
        .filter(item => item.proficiency < 4)
        .map(item => item.grammar_id);
      const unlearnedOrWeakIds = [...new Set([
        ...lowProficiencyIds,
        ...allIds.filter(id => !learnedIds.includes(id))
      ])];

      // 如果全部已熟练，标记完成
      if (unlearnedOrWeakIds.length === 0) {
        this.setData({ allCompleted: true, loading: false, currentGrammar: null });
        wx.hideLoading();
        return;
      }

      // 随机打乱待学语法顺序，初始化currentIndex
      grammarList = this.shuffleArray(unlearnedOrWeakIds);
      currentIndex = 0;

      // 载入当前语法详情
      const firstGrammar = await this.fetchGrammarDetail(grammarList[currentIndex]);
      if (!firstGrammar) {
        wx.showToast({ title: '未找到有效语法条目', icon: 'error' });
        this.setData({ currentGrammar: null, loading: false });
        wx.hideLoading();
        return;
      }

      this.setData({ currentGrammar: firstGrammar, loading: false, showDetail: false });

    } catch (error) {
      console.error('加载语法失败', error);
      wx.showToast({ title: '加载失败，请重试', icon: 'error' });
      this.setData({ loading: false });
    } finally {
      wx.hideLoading();
    }
  },

  async fetchGrammarDetail(grammar_id) {
    try {
      const res = await db.collection('grammar_points')
        .where({ grammar_id })
        .get();
      return res.data.length > 0 ? res.data[0] : null;
    } catch (error) {
      console.error('查询语法详情失败', error);
      return null;
    }
  },

  // 用户选择认识或不认识
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
      // 查询是否已有记录
      const recordRes = await db.collection('user_study_records')
        .where({ user_id: this.userId, grammar_id })
        .get();

      if (recordRes.data.length === 0) {
        // 新增学习记录，熟练度1或0
        await db.collection('user_study_records').add({
          data: {
            user_id: this.userId,
            grammar_id,
            proficiency: known ? 1 : 0,
            review_count: 1,
            study_time: db.serverDate(),
            last_review: db.serverDate()
          }
        });
      } else {
        // 更新已有记录，熟练度+1或-1，范围0-5
        const record = recordRes.data[0];
        let newProficiency = known ? record.proficiency + 1 : record.proficiency - 1;
        newProficiency = Math.max(0, Math.min(5, newProficiency));

        await db.collection('user_study_records').doc(record._id).update({
          data: {
            proficiency: newProficiency,
            review_count: _.inc(1),
            last_review: db.serverDate()
          }
        });
      }

      // 显示语法详情
      this.setData({ showDetail: true });
    } catch (error) {
      console.error('更新学习记录失败', error);
      wx.showToast({ title: '更新失败，请重试', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },

  // 用户点击下一条语法
  async nextGrammar() {
    currentIndex++;
    if (currentIndex >= grammarList.length) {
      // 全部学完，刷新标志
      this.setData({ currentGrammar: null, allCompleted: true, showDetail: false });
      wx.showToast({ title: '已完成全部语法', icon: 'success' });
      return;
    }

    wx.showLoading({ title: '加载下一条' });
    try {
      const nextGrammar = await this.fetchGrammarDetail(grammarList[currentIndex]);
      if (!nextGrammar) {
        wx.showToast({ title: '加载失败，请重试', icon: 'error' });
        this.setData({ showDetail: false });
        wx.hideLoading();
        return;
      }
      this.setData({ currentGrammar: nextGrammar, showDetail: false });
    } catch (error) {
      console.error('加载下一条失败', error);
      wx.showToast({ title: '加载失败，请重试', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },

  // 重置所有学习进度
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

      if (!userRecordsRes.data || userRecordsRes.data.length === 0) {
        wx.showToast({ title: '无复习记录可重置', icon: 'none' });
        wx.hideLoading();
        return;
      }

      // 批量更新熟练度为0
      const updatePromises = userRecordsRes.data.map(record => {
        return db.collection('user_study_records').doc(record._id).update({
          data: { proficiency: 0 }
        });
      });
      await Promise.all(updatePromises);

      wx.showToast({ title: '复习已重置', icon: 'success' });

      // 重新加载学习列表
      this.loadGrammar();

    } catch (error) {
      console.error('重置复习失败', error);
      wx.showToast({ title: '重置失败，请重试', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },

  // Fisher-Yates 洗牌算法，打乱顺序
  shuffleArray(arr) {
    const array = arr.slice();
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
});
