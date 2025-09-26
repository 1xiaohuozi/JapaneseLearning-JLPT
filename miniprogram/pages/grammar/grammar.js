// pages/grammar/grammar.js
const db = wx.cloud.database();
const _ = db.command;
const BATCH_SIZE = 20; // 微信云开发每批最多20条
const PRELOAD_THRESHOLD = 3; // 距离底部3条时预加载

Page({
  data: {
    mode: 'order',
    grammarList: [],
    userRecords: {},
    currentPage: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    searchText: '',
    showModal: false,
    currentGrammar: null,
    currentProficiency: 0,
    currentRecordId: null,
    isLoggedIn: false,
    loadingText: '',
    loadProgress: 0,
    isFavorite: false, // 新增：当前语法是否收藏
    userId: '',
    showMeaning: true
  },

  onLoad(options) {
    this.initData();
    this.loadGrammarList(() => {
      // 检查是否有从分享进入的语法ID参数
      if (options.grammar_id) {
        const grammarId = Number(options.grammar_id);
        this.showGrammarDetailById(grammarId);
      }
    });
    
    this.checkLoginStatus().then(loggedIn => {
      if (loggedIn) this.initUserRecords();
    });
  },
  

  onShow() {
    this.checkLoginStatus();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadMore();
    }
  },

  onPullDownRefresh() {
    this.setData({
      grammarList: [],
      currentPage: 1,
      hasMore: true,
      userRecords: {}
    }, () => {
      getApp().globalData.userRecordsCache = {};
      this.loadGrammarList(() => {
        wx.stopPullDownRefresh();
      });
    });
  },

  initData() {
    this._currentLoadId = 0; // 防止请求乱序
    this._preloadQueue = new Set(); // 预加载队列
  },

 // 修改：检查登录状态时保存userId
 async checkLoginStatus() {
  const app = getApp();
  if (app.globalData.userId) {
    this.setData({ 
      isLoggedIn: true,
      userId: app.globalData.userId 
    });
    return true;
  }
  
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'login'
    });
    if (result.openid) {
      app.globalData.userId = result.openid;
      this.setData({ 
        isLoggedIn: true,
        userId: result.openid 
      });
      return true;
    }
  } catch (err) {
    console.error('登录检查失败:', err);
  }
  this.setData({ 
    isLoggedIn: false,
    userId: '' 
  });
  return false;
},


  initUserRecords() {
    this.setData({
      userRecords: getApp().globalData.userRecordsCache || {}
    });
  },

  async loadGrammarList(callback) {
    if (this.data.loading) return;
    
    const loadId = ++this._currentLoadId;
    this.setData({
      loading: true,
      loadingText: '加载语法点...'
    });

    try {
      let query = db.collection('grammar_points');

      // 搜索条件
      if (this.data.searchText) {
        const regExp = db.RegExp({
          regexp: this.data.searchText,
          options: 'i'
        });
        query = query.where(_.or([
          { grammar_id: regExp },
          { title: regExp },
          { meaning: regExp }
        ]));
      }

      // 排序模式
      if (this.data.mode === 'random') {
        const countRes = await query.count();
        const total = countRes.total;
        if (total === 0) {
          this.setData({ grammarList: [], loading: false, hasMore: false });
          return;
        }

        const randomIndexes = new Set();
        while (randomIndexes.size < Math.min(this.data.pageSize, total)) {
          randomIndexes.add(Math.floor(Math.random() * total));
        }

        const promises = Array.from(randomIndexes).map(index =>
          query.skip(index).limit(1).get()
        );

        const results = await Promise.all(promises);
        const randomData = results.map(res => res.data[0]).filter(Boolean);

        this.setData({
          grammarList: loadId === this._currentLoadId ? randomData : this.data.grammarList,
          loading: false,
          hasMore: false
        });
      } else {
        // 顺序加载
        const res = await query
          .orderBy('grammar_id', 'asc')
          .skip((this.data.currentPage - 1) * this.data.pageSize)
          .limit(this.data.pageSize)
          .get();

        if (loadId === this._currentLoadId) {
          const newList = this.data.grammarList.concat(res.data);
          this.setData({
            grammarList: newList,
            loading: false,
            hasMore: res.data.length === this.data.pageSize
          });

          // 预加载关联的用户记录
          this.preloadUserRecords(res.data);
        }
      }
    } catch (err) {
      console.error('加载失败:', err);
      if (loadId === this._currentLoadId) {
        this.setData({ loading: false });
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        });
      }
    } finally {
      callback && callback();
    }
  },

  async preloadUserRecords(grammarItems) {
    if (!grammarItems || !grammarItems.length) return;
    if (!this.data.isLoggedIn) return;

    const userId = getApp().globalData.userId;
    const neededIds = [];
    const cachedRecords = getApp().globalData.userRecordsCache || {};

    // 找出需要加载的记录ID
    grammarItems.forEach(item => {
      const grammarId = Number(item.grammar_id);
      if (!cachedRecords[grammarId]) {
        neededIds.push(grammarId);
        this._preloadQueue.add(grammarId);
      }
    });

    if (neededIds.length === 0) return;

    this.setData({
      loadingText: `加载学习进度 (${neededIds.length}条)`
    });

    try {
      // 分批加载
      const batchCount = Math.ceil(neededIds.length / BATCH_SIZE);
      let loadedCount = 0;

      for (let i = 0; i < batchCount; i++) {
        const batchIds = neededIds.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        
        const res = await db.collection('user_study_records')
          .where({
            user_id: userId,
            grammar_id: _.in(batchIds)
          })
          .get();

        // 更新缓存
        const updatedRecords = { ...getApp().globalData.userRecordsCache };
        res.data.forEach(item => {
          const grammarId = Number(item.grammar_id);
          updatedRecords[grammarId] = item;
          this._preloadQueue.delete(grammarId);
        });

        getApp().globalData.userRecordsCache = updatedRecords;
        loadedCount += res.data.length;

        // 更新UI
        this.setData({
          userRecords: updatedRecords,
          loadProgress: Math.round((loadedCount / neededIds.length) * 100)
        });
      }
    } catch (err) {
      console.error('预加载失败:', err);
    } finally {
      if (this._preloadQueue.size === 0) {
        this.setData({
          loadingText: '',
          loadProgress: 0
        });
      }
    }
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.setData({
      currentPage: this.data.currentPage + 1
    }, this.loadGrammarList);
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (this.data.mode === mode) return;

    this.setData({
      mode,
      grammarList: [],
      currentPage: 1,
      hasMore: true
    }, this.loadGrammarList);
  },

  onSearchInput(e) {
    const text = e.detail.value.trim();
    this.setData({
      searchText: text,
      grammarList: [],
      currentPage: 1,
      hasMore: true
    }, () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this.loadGrammarList();
      }, 500);
    });
  },

  showDetail(e) {
    const grammarId = Number(e.currentTarget.dataset.id);
    const grammar = this.data.grammarList.find(
      item => Number(item.grammar_id) === grammarId
    );
    
    if (!grammar) return;

    const record = this.data.userRecords[grammarId];
    this.setData({
      showModal: true,
      currentGrammar: grammar,
      currentProficiency: record ? record.proficiency : 0,
      currentRecordId: record ? record._id : null
    }, () => {
      // 显示详情后检查收藏状态
      if (this.data.isLoggedIn && this.data.userId) {
        this.checkFavoriteStatus(grammarId);
      }
    });
  },
  hideDetail() {
    this.setData({ showModal: false });
  },

  setProficiency(e) {
    this.setData({
      currentProficiency: Number(e.currentTarget.dataset.value)
    });
  },

  async updateProficiency() {
    if (!this.data.currentGrammar || !this.data.isLoggedIn) return;

    const userId = getApp().globalData.userId;
    const grammarId = Number(this.data.currentGrammar.grammar_id);
    const proficiency = this.data.currentProficiency;

    wx.showLoading({ title: '保存中...', mask: true });

    try {
      if (this.data.currentRecordId) {
        // 更新现有记录
        await db.collection('user_study_records')
          .doc(this.data.currentRecordId)
          .update({
            data: {
              proficiency,
              last_review: db.serverDate(),
              review_count: _.inc(1),
              updated_at: db.serverDate()
            }
          });
      } else {
        // 创建新记录
        const res = await db.collection('user_study_records')
          .add({
            data: {
              user_id: userId,
              grammar_id: grammarId,
              proficiency,
              study_time: db.serverDate(),
              last_review: db.serverDate(),
              review_count: 1,
              created_at: db.serverDate(),
              updated_at: db.serverDate()
            }
          });
        this.setData({ currentRecordId: res._id });
      }

      // 更新本地缓存
      const updatedRecords = { 
        ...getApp().globalData.userRecordsCache,
        [grammarId]: {
          ...(this.data.userRecords[grammarId] || {}),
          proficiency,
          last_review: new Date(),
          review_count: (this.data.userRecords[grammarId]?.review_count || 0) + 1
        }
      };
      getApp().globalData.userRecordsCache = updatedRecords;

      this.setData({
        userRecords: updatedRecords,
        showModal: false
      });
      wx.hideLoading();
      wx.showToast({ title: '保存成功' });
    } catch (err) {
      console.error('保存失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  clearSearch() {
    if (!this.data.searchText) return;
    this.setData({
      searchText: '',
      grammarList: [],
      currentPage: 1,
      hasMore: true
    }, this.loadGrammarList);
  },
// 新增：检查收藏状态
async checkFavoriteStatus(grammar_id) {
  if (!this.data.userId || !grammar_id) {
    this.setData({ isFavorite: false });
    return;
  }
  
  try {
    const res = await db.collection('user_favorites')
      .where({ 
        user_id: this.data.userId, 
        grammar_id: grammar_id 
      })
      .count();
      
    this.setData({ 
      isFavorite: res.total > 0 
    });
  } catch (error) {
    console.error('检查收藏状态失败:', error);
    this.setData({ isFavorite: false });
  }
},

// 修改：切换收藏状态
async toggleFavorite() {
  if (!this.checkLogin()) return; 

  if (!this.data.currentGrammar) {
    return;
  }

  const grammar_id = this.data.currentGrammar.grammar_id;
  const userId = this.data.userId;
  
  wx.showLoading({ title: '处理中', mask: true });
  
  try {
    // 检查是否已收藏
    const checkRes = await db.collection('user_favorites')
      .where({ 
        user_id: userId, 
        grammar_id: grammar_id 
      })
      .get();
    
    if (checkRes.data.length > 0) {
      // 已收藏 -> 取消收藏
      await db.collection('user_favorites').doc(checkRes.data[0]._id).remove();
      this.setData({ isFavorite: false });
      wx.showToast({ title: '已取消收藏', icon: 'success' });
    } else {
      // 未收藏 -> 添加收藏
      await db.collection('user_favorites').add({
        data: {
          user_id: userId,
          grammar_id: grammar_id,
          create_time: db.serverDate()
        }
      });
      this.setData({ isFavorite: true });
      wx.showToast({ title: '已收藏', icon: 'success' });
    }
  } catch (error) {
    console.error('收藏操作失败:', error);
    wx.showToast({ title: '操作失败', icon: 'error' });
  } finally {
    wx.hideLoading();
  }
},
toggleMeaning(e) {
  this.setData({
    showMeaning: e.detail.value
  });
},
// 新增方法：根据ID直接显示语法详情
async showGrammarDetailById(grammarId) {
  // 先检查当前列表是否已加载该语法
  let grammar = this.data.grammarList.find(
    item => Number(item.grammar_id) === grammarId
  );
  
  // 如果列表中没有，则单独查询
  if (!grammar) {
    try {
      const res = await db.collection('grammar_points')
        .where({ grammar_id: grammarId })
        .get();
      
      if (res.data.length > 0) {
        grammar = res.data[0];
        // 添加到当前列表
        this.setData({
          grammarList: [...this.data.grammarList, grammar]
        });
      }
    } catch (err) {
      console.error('查询语法详情失败:', err);
    }
  }
  
  if (grammar) {
    this.showDetail({ currentTarget: { dataset: { id: grammarId } } });
  }
},

// 修改分享方法
onShareAppMessage() {
  const { currentGrammar, searchText, mode } = this.data;
  
  let title = '日语备考通速记 - 高效备考工具';
  let path = '/pages/grammar/grammar';
  
  if (currentGrammar) {
    title = `[N2语法] ${currentGrammar.title}: ${currentGrammar.meaning.substring(0, 15)}...`;
    path = `${path}?grammar_id=${currentGrammar.grammar_id}`;
  } else if (searchText) {
    title = `我正在学习"${searchText}"相关的N2语法`;
    path = `${path}?search=${encodeURIComponent(searchText)}`;
  } else {
    title = `我正在使用${mode === 'random' ? '随机' : '顺序'}模式学习N2语法`;
  }
  
  return {
    title,
    path,
    imageUrl: '../../images/蓝宝书.png'
  }
},



 

});