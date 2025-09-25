const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    userId: '',
    allList: [],       // 合并后的完整数据
    favoritesList: [],   // 当前展示数据（分页或搜索结果）
    pageIndex: 0,
    pageSize: 10,
    hasMore: true,
    loading: false,
    searchText: '',
    showModal: false,
    currentGrammar: {},
    showMeaning: true// 默认显示语法意思
  },

  onLoad() {
    const userId = wx.getStorageSync('userId');
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/profile/login/login' });
      }, 1500);
      return;
    }
    this.setData({ userId }, this.loadAllFavorites);
  },

  async loadAllFavorites() {
    wx.showLoading({ title: '加载中' });
    try {
      const favRes = await db.collection('user_favorites')
        .where({ user_id: this.data.userId })
        .orderBy('create_time', 'desc')
        .get();

      const favorites = favRes.data || [];
      const grammarIds = favorites.map(fav => fav.grammar_id);

      if (grammarIds.length === 0) {
        this.setData({ allList: [], favoritesList: [], hasMore: false });
        wx.hideLoading();
        return;
      }

      // 批量查找语法信息
      const grammarRes = await db.collection('grammar_points')
        .where({ grammar_id: _.in(grammarIds) })
        .get();

      const grammarMap = {};
      grammarRes.data.forEach(g => {
        grammarMap[g.grammar_id] = g;
      });

      // 合并信息
      const merged = favorites.map(fav => {
        const grammar = grammarMap[fav.grammar_id];
        return grammar ? {
          ...grammar,
          create_time: this.formatTime(fav.create_time),
          grammar_id: fav.grammar_id
        } : null;
      }).filter(Boolean);

      this.setData({
        allList: merged,
        pageIndex: 0,
        favoritesList: [],
        hasMore: true
      }, this.loadPagedData);
      console.log('当前用户ID:', this.data.userId);
      console.log('user_favorites 查询结果:', favorites);
      console.log('grammarIds 提取结果:', grammarIds);
      console.log('grammar_points 查询结果:', grammarRes.data);
      
    } catch (err) {
      console.error('加载收藏失败：', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  loadPagedData() {
    const { allList, pageIndex, pageSize, favoritesList } = this.data;
    const nextItems = allList.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

    this.setData({
      favoritesList: favoritesList.concat(nextItems),
      hasMore: allList.length > (pageIndex + 1) * pageSize,
      loading: false
    });
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.setData({ loading: true, pageIndex: this.data.pageIndex + 1 }, this.loadPagedData);
  },

  onSearchInput(e) {
    const searchText = e.detail.value.trim();
    this.setData({ searchText });

    if (!searchText) {
      this.resetPagination();
      return;
    }

    const filtered = this.data.allList.filter(item =>
      item.title?.includes(searchText) ||
      item.meaning?.includes(searchText) ||
      item.grammar_id?.toString().includes(searchText)
    );

    this.setData({
      favoritesList: filtered,
      hasMore: false,
      pageIndex: 0
    });
  },

  clearSearch() {
    this.setData({ searchText: '' }, this.resetPagination);
  },

  resetPagination() {
    this.setData({
      favoritesList: [],
      pageIndex: 0,
      hasMore: true
    }, this.loadPagedData);
  },

  showDetail(e) {
    const id = e.currentTarget.dataset.id;
    const grammar = this.data.allList.find(item => item.grammar_id == id);
    if (grammar) {
      this.setData({ currentGrammar: grammar, showModal: true });
    }
  },

  hideDetail() {
    this.setData({ showModal: false });
  },

  formatTime(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  },
  async removeFavorite() {
    const { userId, currentGrammar } = this.data;
    if (!userId || !currentGrammar.grammar_id) return;
  
    wx.showModal({
      title: '确认操作',
      content: `确定要移除「${currentGrammar.title}」的收藏吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            // 从 user_favorites 中删除对应收藏记录
            await db.collection('user_favorites')
              .where({
                user_id: userId,
                grammar_id: currentGrammar.grammar_id
              })
              .remove();
  
            wx.showToast({ title: '已取消收藏', icon: 'success' });
  
            // 从本地数据中移除该项
            const updatedAllList = this.data.allList.filter(item => item.grammar_id !== currentGrammar.grammar_id);
            const updatedFavoritesList = this.data.favoritesList.filter(item => item.grammar_id !== currentGrammar.grammar_id);
  
            this.setData({
              allList: updatedAllList,
              favoritesList: updatedFavoritesList,
              showModal: false
            });
          } catch (err) {
            console.error('移除收藏失败', err);
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  },
  toggleMeaning(e) {
    this.setData({
      showMeaning: e.detail.value
    });
  }
  
  
});
