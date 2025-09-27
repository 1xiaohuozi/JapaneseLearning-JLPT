// word-learning.js
const db = wx.cloud.database();
const _ = db.command;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1小时
const PAGE_SIZE_DEFAULT = 20;
// ✅ 短间隔：小于该值的卡会插入本轮复习队列
const SHORT_INTERVAL_MS = 30 * 60 * 1000; // 30分钟

Page({
  data: {
    // 视图状态
    currentTab: 'study',

    // 等级与集合映射
    levels: ['N1', 'N2', 'N3', 'N4/N5'],
    levelIndex: 1, // 默认 N2
    collectionMap: {
      N1: 'n1_words',
      N2: 'n2_words',
      N3: 'n3_words',
      'N4/N5': 'n4n5_words',
    },

    // 数据区
    words: [],                // 当前等级下已加载的词（分页累积）
    filteredWords: [],        // 搜索过滤后的词
    searchQuery: "",

    favoriteWords: [],        // 收藏Tab下的词
    currentIndex: 0,          // 学习卡片当前索引（在 words 中的位置）
    currentWord: {},          // 学习卡片当前词
    isFavorited: false,       // 当前词是否收藏
    answered: false,          // 翻卡状态
    lastChoice: null,         // 上一次选择
    btnDisabled: false,       // 防止重复点击
    showDetail: false,
    detailWord: {},
    // 分页状态（词列表）
    page: 0,
    pageSize: PAGE_SIZE_DEFAULT,
    hasMoreWords: true,
    loadingWords: false,
    totalWords: 0,            // 总条数（缓存）

    // 收藏分页（进入收藏Tab才查）
    favPage: 0,
    hasMoreFavorites: true,
    loadingFavorites: false,

    // 批量状态映射
    favMap: {},               // { word_id: true }
    profMap: {},              // { word_id: proficiency }

    // ✅ 新增：复习队列（只存 word_id）
    reviewQueue: []
  },

  /* ------------------------
   * 生命周期
   * ------------------------ */
  async onLoad() {
    await this.initWordsSWROnLoad();   // 先把词加载起来
    await this.restoreProgressIfAny(); // 再恢复进度（支持云端）
  },

  onShow() {
    // 轻量校验第一页（不打断当前Tab）
    this.revalidateFirstPageSilently();
  },

  /* ------------------------
   * 工具：id、keys
   * ------------------------ */
  getUserId() {
    // 未登录返回 null；不要再默认 'guest' 写库
    return wx.getStorageSync('userId') || null;
  },
  getUserKey() {
    return this.getUserId() || 'guest';
  },
  getCurrentCollection() {
    const level = this.data.levels[this.data.levelIndex];
    return this.data.collectionMap[level];
  },
  getWordsCacheKey() {
    // 词库按集合缓存，不区分用户
    return 'words_cache_' + this.getCurrentCollection();
  },
  getTotalCacheKey() {
    return 'words_total_' + this.getCurrentCollection();
  },
  getProgressKey() {
    // ✅ 进度按 用户 + 集合 缓存
    return `progress_${this.getUserKey()}_${this.getCurrentCollection()}`;
  },

  /* ------------------------
   * 初始化：SWR（缓存先行，后台校验）
   * ------------------------ */
  async initWordsSWROnLoad() {
    const collectionName = this.getCurrentCollection();
    const cacheKey = this.getWordsCacheKey();
    const totalKey = this.getTotalCacheKey();
    const cached = wx.getStorageSync(cacheKey);
    const cachedTotal = wx.getStorageSync(totalKey);

    if (cached && cached.data && (Date.now() - cached.time < CACHE_TTL_MS)) {
      const words = cached.data;
      this.setData({
        words,
        totalWords: cachedTotal && typeof cachedTotal.total === 'number' ? cachedTotal.total : words.length,
        page: Math.ceil(words.length / this.data.pageSize),
        hasMoreWords: true,
        filteredWords: words,
      });
      if (words.length > 0) {
        // ⚠️ 不在这里设定 currentWord，等 restoreProgressIfAny 决定
      }
    } else {
      this.setData({
        words: [],
        filteredWords: [],
        totalWords: 0,
        page: 0,
        hasMoreWords: true,
      });
    }

    await this.loadFirstPageAndCache(collectionName);
  },

  async revalidateFirstPageSilently() {
    if (this.data.currentTab === 'favorites') return;
    try {
      const collectionName = this.getCurrentCollection();
      const res = await db.collection(collectionName)
        .orderBy('order', 'asc')
        .limit(this.data.pageSize)
        .get();

      const fresh = await this.attachFavAndProf(res.data);
      const cacheKey = this.getWordsCacheKey();
      const cached = wx.getStorageSync(cacheKey);

      if (!cached || JSON.stringify(cached.data.slice(0, fresh.length)) !== JSON.stringify(fresh)) {
        const merged = [...fresh];
        if (this.data.words.length > fresh.length) {
          merged.push(...this.data.words.slice(fresh.length));
        }
        this.setData({ words: merged, filteredWords: this.filterByQuery(merged, this.data.searchQuery) });
        wx.setStorageSync(cacheKey, { data: merged, time: Date.now() });
      }

      const countRes = await db.collection(collectionName).count();
      this.setData({ totalWords: countRes.total });
      wx.setStorageSync(this.getTotalCacheKey(), { total: countRes.total, time: Date.now() });
    } catch (e) {
      // 静默即可
    }
  },

  async loadFirstPageAndCache(collectionName) {
    try {
      const totalKey = this.getTotalCacheKey();
      const cachedTotal = wx.getStorageSync(totalKey);
      if (!(cachedTotal && (Date.now() - cachedTotal.time < CACHE_TTL_MS))) {
        const c = await db.collection(collectionName).count();
        this.setData({ totalWords: c.total });
        wx.setStorageSync(totalKey, { total: c.total, time: Date.now() });
      } else {
        this.setData({ totalWords: cachedTotal.total });
      }

      const res = await db.collection(collectionName)
        .orderBy('order', 'asc')
        .limit(this.data.pageSize)
        .get();

      const pageData = await this.attachFavAndProf(res.data);
      const cacheKey = this.getWordsCacheKey();

      this.setData({
        words: pageData,
        filteredWords: this.filterByQuery(pageData, this.data.searchQuery),
        page: 1,
        hasMoreWords: pageData.length >= this.data.pageSize,
      });

      wx.setStorageSync(cacheKey, { data: pageData, time: Date.now() });
    } catch (err) {
      console.error('初始化失败:', err);
    }
  },

  /* ------------------------
   * 合并 收藏/熟练度/下次复习
   * ------------------------ */
  async attachFavAndProf(words) {
    if (!words || words.length === 0) return [];
    const userId = this.getUserId();

    // 收藏
    let favMapPatch = {};
    try {
      if (userId) {
        const favRes = await db.collection('user_word_favorites')
          .where({ user_id: userId, word_id: _.in(words.map(w => w._id)) })
          .field({ word_id: true })
          .get();
        favRes.data.forEach(x => { favMapPatch[x.word_id] = true; });
      }
    } catch (e) {
      favMapPatch = {};
    }
    this.setData({ favMap: { ...this.data.favMap, ...favMapPatch } });

    // 熟练度 & 下次复习
    let profMapPatch = {};
    const nextMap = {};
    try {
      if (userId) {
        const profRes = await db.collection('user_word_records')
          .where({ user_id: userId, word_id: _.in(words.map(w => w._id)) })
          .field({ word_id: true, proficiency: true, nextReview: true }) // ✅ 带出 nextReview
          .get();
        profRes.data.forEach(r => {
          profMapPatch[r.word_id] = r.proficiency || 0;
          if (r.nextReview) nextMap[r.word_id] = r.nextReview;
        });
      }
    } catch (e) {
      // 忽略
    }
    this.setData({ profMap: { ...this.data.profMap, ...profMapPatch } });

    return words.map(w => ({
      ...w,
      proficiency: this.data.profMap[w._id] || 0,
      _isFavorited: !!(this.data.favMap[w._id] || false),
      nextReview: nextMap[w._id] || null, // ✅ 合并 nextReview，供到期判断
    }));
  },

  /* ------------------------
   * 进度 恢复（云端优先，本地回退）
   * ------------------------ */
  async restoreProgressIfAny() {
    const collectionName = this.getCurrentCollection();
    const userId = this.getUserId();
  
    let progress = null;
  
    // 1) 本地优先（立即可用）
    const local = wx.getStorageSync(this.getProgressKey());
    if (local && local.wordId) {
      progress = {
        wordId: local.wordId,
        index: typeof local.index === 'number' ? local.index : 0,
        queue: Array.isArray(local.queue) ? local.queue : [],
      };
    }
  
    // 2) 云端兜底（异步，不阻塞 UI）
    if (userId) {
      wx.showToast({
        title: '加载上次进度中...',
        icon: 'loading',
        mask: true,       // 👈 避免用户乱点
        duration: 1000   // 👈 给个足够大的值，手动关闭
      });
  
      db.collection('user_word_progress')
        .where({ user_id: userId, collection: collectionName })
        .limit(1)
        .get()
        .then(res => {
          if (res.data && res.data.length) {
            const p = res.data[0];
            const cloudProgress = {
              wordId: p.word_id,
              index: typeof p.index === 'number' ? p.index : 0,
              queue: Array.isArray(p.queue) ? p.queue : [],
            };
            // 如果云端比本地新 → 覆盖
            if (!progress || (cloudProgress.update_time > (progress.update_time || 0))) {
              this.applyProgress(cloudProgress);
              // 写回本地缓存
              wx.setStorageSync(this.getProgressKey(), cloudProgress);
            }
          }
        })
        .catch(err => {
          console.warn("❌ 云端进度获取失败:", err);
        });
    }
  
    // 3) 应用进度（用本地的，秒开）
    if (progress) {
      this.applyProgress(progress);
    } else if (this.data.words.length > 0) {
      // 没有任何进度 → 默认第一条
      this.setData({
        currentIndex: 0,
        currentWord: this.data.words[0],
        isFavorited: !!(this.data.favMap[this.data.words[0]._id] || false),
        answered: false,
        lastChoice: null,
      });
    }
  },
  
  /**
   * 应用进度到页面
   */
  async applyProgress(progress) {
    // 队列恢复（只保留 dueTime 已到的）
    const now = Date.now();
    const validQueue = (progress.queue || []).filter(
      item => !item.due || now < item.due || typeof item === 'string' // 兼容旧数据
    );
    this.setData({ reviewQueue: validQueue });
  
    // 定位单词
    let idx = this.data.words.findIndex(w => w._id === progress.wordId);
  
    while (idx === -1 && this.data.hasMoreWords) {
      await this.loadMoreWords();
      idx = this.data.words.findIndex(w => w._id === progress.wordId);
    }
  
    if (idx === -1) {
      idx = (progress.index >= 0 && progress.index < this.data.words.length)
        ? progress.index
        : 0;
    }
  
    const w = this.data.words[idx];
    if (w) {
      this.setData({
        currentIndex: idx,
        currentWord: w,
        isFavorited: !!(this.data.favMap[w._id] || false),
        answered: false,
        lastChoice: null,
      });
    }
  },  

  /* ------------------------
   * 进度 保存（云端 + 本地）
   * ------------------------ */
  async saveProgress() {
    const { currentWord, currentIndex, reviewQueue } = this.data;
    if (!currentWord || !currentWord._id) return;
  
    const collectionName = this.getCurrentCollection();
    const userId = this.getUserId();
    const key = this.getProgressKey(); // 👉 推荐拼接 userId+collectionName
  
    const payload = {
      wordId: currentWord._id,
      index: currentIndex,
      queue: reviewQueue,
      time: Date.now(),
    };
  
    // 1) 本地存完整进度（含队列）
    wx.setStorageSync(key, payload);
  
    // 2) 云端存储（仅登录用户）
    if (userId) {
      try {
        // 用 userId+collectionName 作为唯一 _id → 幂等写入
        const docId = `${userId}_${collectionName}`;
        await db.collection('user_word_progress').doc(docId).set({
          data: {
            user_id: userId,
            collection: collectionName,
            word_id: currentWord._id,
            index: currentIndex,
            queue: reviewQueue,
            update_time: db.serverDate(),
          }
        });
      } catch (e) {
        console.warn("❌ 保存云端进度失败，已回退本地:", e);
      }
    }
  },  

  /* ------------------------
   * 等级切换
   * ------------------------ */
  async onLevelChange(e) {
    const index = e.detail.value;
    this.setData({
      levelIndex: index,
      words: [],
      filteredWords: [],
      favoriteWords: [],
      page: 0,
      favPage: 0,
      hasMoreWords: true,
      hasMoreFavorites: true,
      currentIndex: 0,
      currentWord: {},
      answered: false,
      lastChoice: null,
      favMap: {},
      profMap: {},
      reviewQueue: [], // ✅ 切级别清空队列
    });

    await this.initWordsSWROnLoad();
    await this.restoreProgressIfAny();
  },

  /* ------------------------
   * 分页加载词（列表/学习共用）
   * ------------------------ */
  async loadMoreWords() {
    if (this.data.loadingWords || !this.data.hasMoreWords) return;
    this.setData({ loadingWords: true });

    try {
      const collectionName = this.getCurrentCollection();
      const res = await db.collection(collectionName)
        .orderBy('order', 'asc')
        .skip(this.data.page * this.data.pageSize)
        .limit(this.data.pageSize)
        .get();

      const newPage = await this.attachFavAndProf(res.data);
      const allWords = [...this.data.words, ...newPage];

      this.setData({
        words: allWords,
        page: this.data.page + 1,
        filteredWords: this.filterByQuery(allWords, this.data.searchQuery),
        hasMoreWords: newPage.length >= this.data.pageSize,
      });

      // 刷新缓存（保前若干页）
      const maxCacheItems = this.data.pageSize * 10;
      const pruned = allWords.slice(0, maxCacheItems);
      wx.setStorageSync(this.getWordsCacheKey(), { data: pruned, time: Date.now() });

    } catch (err) {
      console.error('加载单词失败:', err);
    } finally {
      this.setData({ loadingWords: false });
    }
  },

  /* ------------------------
   * 收藏Tab（进入时再拉，确保实时）
   * ------------------------ */
  async loadMoreFavorites() {
    if (this.data.loadingFavorites || !this.data.hasMoreFavorites) return;
    this.setData({ loadingFavorites: true });

    const userId = this.getUserId();
    if (!userId) {
      this.setData({ loadingFavorites: false, hasMoreFavorites: false });
      wx.showToast({ title: '请先登录查看收藏', icon: 'none' });
      return;
    }

    try {
      const favDocsRes = await db.collection('user_word_favorites')
        .where({ user_id: userId })
        .orderBy('create_time', 'desc')
        .skip(this.data.favPage * this.data.pageSize)
        .limit(this.data.pageSize)
        .get();

      if (favDocsRes.data.length < this.data.pageSize) {
        this.setData({ hasMoreFavorites: false });
      }

      const wordIds = favDocsRes.data.map(x => x.word_id);
      if (wordIds.length === 0) {
        this.setData({ loadingFavorites: false });
        return;
      }

      const collectionName = this.getCurrentCollection();
      const wordRes = await db.collection(collectionName)
        .where({ _id: _.in(wordIds) })
        .get();

      const list = await this.attachFavAndProf(wordRes.data);

      this.setData({
        favoriteWords: [...this.data.favoriteWords, ...list],
        favPage: this.data.favPage + 1,
      });
    } catch (err) {
      console.error('加载收藏失败:', err);
    } finally {
      this.setData({ loadingFavorites: false });
    }
  },

  /* ------------------------
   * Tab切换：收藏/列表按需加载
   * ------------------------ */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });

    if (tab === 'favorites') {
      this.setData({
        favoriteWords: [],
        favPage: 0,
        hasMoreFavorites: true,
      });
      this.loadMoreFavorites();
    } else if (tab === 'all') {
      if (!this.data.words || this.data.words.length === 0) {
        this.setData({ page: 0, hasMoreWords: true });
        this.loadMoreWords();
      }
    }
  },

  /* ------------------------
   * 收藏/取消收藏
   * ------------------------ */
  async toggleFavorite() {
    if (!this.checkLogin()) return; // 登录引导
    const userId = this.getUserId();
    const { currentWord } = this.data;
    if (!currentWord || !currentWord._id) return;

    try {
      const collection = db.collection('user_word_favorites');
      if (this.data.isFavorited) {
        const res = await collection.where({ user_id: userId, word_id: currentWord._id }).get();
        if (res.data.length) await collection.doc(res.data[0]._id).remove();
        this.setData({
          isFavorited: false,
          favMap: { ...this.data.favMap, [currentWord._id]: false },
        });
      } else {
        await collection.add({
          data: {
            user_id: userId,
            word_id: currentWord._id,
            create_time: db.serverDate(),
          },
        });
        this.setData({
          isFavorited: true,
          favMap: { ...this.data.favMap, [currentWord._id]: true },
        });
      }

      if (this.data.currentTab === 'favorites') {
        this.setData({ favoriteWords: [], favPage: 0, hasMoreFavorites: true });
        this.loadMoreFavorites();
      }
    } catch (err) {
      console.error('收藏操作失败:', err);
    }
  },

  /* ------------------------
   * 查看详情：跳回学习卡片并即时展示收藏状态
   * ------------------------ */
  viewWordDetail(e) {
    const wordId = e.currentTarget.dataset.id;
    const word = this.data.words.find(w => w._id === wordId)
      || this.data.favoriteWords.find(w => w._id === wordId);

    if (word) {
      const idx = this.data.words.findIndex(w => w._id === wordId);
      this.setData({
        currentTab: 'study',
        currentWord: word,
        currentIndex: idx >= 0 ? idx : this.data.currentIndex,
        answered: false,
        lastChoice: null,
        isFavorited: !!(this.data.favMap[word._id] || false),
      });
      this.saveProgress();
    }
  },

  /* ------------------------
   * 学习：认识 / 不认识
   * ------------------------ */
  chooseKnown() {
    if (!this.checkLogin()) return; // 熟练度需要登录；如果你允许未登录练习，可移除此行
    if (this.data.btnDisabled) return;

    this.setData({ btnDisabled: true });
    this.updateSM2(true).then((interval) => {
      // ✅ 短间隔 → 插入复习队列
      if (interval < SHORT_INTERVAL_MS) {
        const q = this.data.reviewQueue.slice();
        q.push({
          id: this.data.currentWord._id,
          dueTime: Date.now() + 30 * 1000  // 3分钟后才能复习
        });
        this.setData({ reviewQueue: q });
      }
      this.setData({ answered: true, lastChoice: 1, btnDisabled: false });
      this.saveProgress();

      if (this.data.currentWord.sounds && this.data.currentWord.sounds.length > 0) {
        this.playAudio({ currentTarget: { dataset: { src: this.data.currentWord.sounds[0].fileid } } });
      }
    });
  },

  chooseUnknown() {
    // 若希望未登录也能“不认识→插队”但不写库，可把登录判断放到 updateSM2 内部
    if (!this.checkLogin()) return;
    if (this.data.btnDisabled) return;

    this.setData({ btnDisabled: true });
    this.updateSM2(false).then(() => {
      const q = this.data.reviewQueue.slice();
      q.push({
        id: this.data.currentWord._id,
        dueTime: Date.now() + 30 * 1000  // 3分钟后才能复习
      });
      this.setData({ reviewQueue: q, answered: true, lastChoice: 0, btnDisabled: false });
      this.saveProgress();

      if (this.data.currentWord.sounds && this.data.currentWord.sounds.length > 0) {
        this.playAudio({ currentTarget: { dataset: { src: this.data.currentWord.sounds[0].fileid } } });
      }
    });
  },

  /* ------------------------
   * 更新熟练度 + 下次复习时间（返回 interval）
   * ------------------------ */
  getNextIntervalMs(proficiency = 0, isKnown = true) {
    if (!isKnown) return 5 * 60 * 1000; // 不认识：5分钟后
    const schedule = [
      5 * 60 * 1000,          // 5 分钟
      30 * 60 * 1000,         // 30 分钟
      12 * 60 * 60 * 1000,    // 12 小时
      2 * 24 * 60 * 60 * 1000,// 2 天
      5 * 24 * 60 * 60 * 1000,// 5 天
      10 * 24 * 60 * 60 * 1000,// 10 天
    ];
    const idx = Math.max(0, Math.min(proficiency, schedule.length - 1));
    return schedule[idx];
  },

  async updateSM2(isKnown) {
    const userId = this.getUserId();
    const { currentWord } = this.data;
    if (!currentWord || !currentWord._id) return 5 * 60 * 1000;

    // 未登录：允许本地练习但不写云库（若你想强制登录，已在 chooseKnown/Unknown 拦截）
    const oldProf = this.data.profMap[currentWord._id] || 0;
    const interval = this.getNextIntervalMs(oldProf, isKnown);
    const nextReview = new Date(Date.now() + interval);

    // 本地映射更新（内存）
    const newProfLocal = Math.max(0, oldProf + (isKnown ? 1 : -1));
    this.setData({ profMap: { ...this.data.profMap, [currentWord._id]: newProfLocal } });

    // 写云（登录用户）
    if (userId) {
      try {
        const res = await db.collection('user_word_records')
          .where({ user_id: userId, word_id: currentWord._id })
          .get();

        if (res.data.length === 0) {
          await db.collection('user_word_records').add({
            data: {
              user_id: userId,
              word_id: currentWord._id,
              proficiency: isKnown ? 1 : 0,
              nextReview,
              create_time: db.serverDate(),
              update_time: db.serverDate(),
            }
          });
        } else {
          const record = res.data[0];
          const newProficiency = Math.max(0, (record.proficiency || 0) + (isKnown ? 1 : -1));
          await db.collection('user_word_records').doc(record._id).update({
            data: {
              proficiency: newProficiency,
              nextReview,
              update_time: db.serverDate(),
            }
          });
          // 内存同步
          this.setData({ profMap: { ...this.data.profMap, [currentWord._id]: newProficiency } });
        }
      } catch (err) {
        console.error('更新SM2失败:', err);
      }
    }

    // 把 nextReview 写回 words（避免等下次拉数据）
    const idx = this.data.words.findIndex(w => w._id === currentWord._id);
    if (idx >= 0) {
      const patch = {};
      patch[`words[${idx}].nextReview`] = nextReview;
      this.setData(patch);
    }

    return interval;
  },

  /* ------------------------
   * 下一个（支持复习队列 + 环扫）
   * ------------------------ */
  isDue(word) {
    return !word.nextReview || Date.now() >= new Date(word.nextReview).getTime();
  },  

  async nextWord() {
    let target = null;
    let idx = -1;
  
    // 先复位翻转状态，避免背面直接出来
    this.setData({ answered: false, lastChoice: null });
  
    // 1) 优先从队列取，检查 due
    if (this.data.reviewQueue.length > 0) {
      const q = [...this.data.reviewQueue];
      for (let i = 0; i < q.length; i++) {
        if (Date.now() >= q[i].due) {
          const nextId = q[i].id;
          q.splice(i, 1); // 移出队列
          this.setData({ reviewQueue: q });
  
          idx = this.data.words.findIndex(w => w._id === nextId);
          while (idx === -1 && this.data.hasMoreWords) {
            await this.loadMoreWords();
            idx = this.data.words.findIndex(w => w._id === nextId);
          }
          if (idx !== -1) target = this.data.words[idx];
          break;
        }
      }
    }
  
    // 2) 顺序找下一个 due 的新词
    if (!target) {
      for (let i = this.data.currentIndex + 1; i < this.data.words.length; i++) {
        if (this.isDue(this.data.words[i])) {
          target = this.data.words[i];
          idx = i;
          break;
        }
      }
    }
  
    // 3) 环扫前半段
    if (!target) {
      for (let i = 0; i <= this.data.currentIndex; i++) {
        if (this.isDue(this.data.words[i])) {
          target = this.data.words[i];
          idx = i;
          break;
        }
      }
    }
  
    // 4) 拉更多再找
    if (!target && this.data.hasMoreWords) {
      await this.loadMoreWords();
      for (let i = this.data.currentIndex + 1; i < this.data.words.length; i++) {
        if (this.isDue(this.data.words[i])) {
          target = this.data.words[i];
          idx = i;
          break;
        }
      }
    }
  
    if (!target) {
      wx.showToast({ title: '✅ 本轮学习完成！', icon: 'success' });
      return;
    }
  
    // 延迟 300ms 等待 UI 翻转回正面，再切换单词
    setTimeout(() => {
      this.setData({
        currentWord: target,
        currentIndex: idx >= 0 ? idx : this.data.currentIndex,
        isFavorited: !!(this.data.favMap[target._id] || false),
      });
      this.saveProgress();
    }, 350);
  },  

  /* ------------------------
   * 音频播放
   * ------------------------ */
  playAudio(e) {
    const fileid = e.currentTarget.dataset.src;
    if (!fileid) return;

    wx.cloud.getTempFileURL({
      fileList: [fileid],
      success: res => {
        const tempUrl = res.fileList[0].tempFileURL;
        const innerAudioContext = wx.createInnerAudioContext();
        innerAudioContext.src = tempUrl;
        innerAudioContext.play();
        innerAudioContext.onEnded(() => innerAudioContext.destroy());
        innerAudioContext.onError(() => innerAudioContext.destroy());
      },
      fail: err => {
        console.error('获取临时链接失败:', err);
      }
    });
  },

  /* ------------------------
   * 搜索
   * ------------------------ */
  onSearchInput(e) {
    const query = e.detail.value.trim().toLowerCase();
    this.setData({ searchQuery: query });
    this.setData({ filteredWords: this.filterByQuery(this.data.words, query) });
  },

  filterByQuery(words, query) {
    if (!query) return words;
    const q = query.toLowerCase();
    return words.filter(word =>
      (word.word && String(word.word).toLowerCase().includes(q)) ||
      (word.kana && String(word.kana).toLowerCase().includes(q)) ||
      (word.meaning && String(word.meaning).toLowerCase().includes(q))
    );
  },

  /* ------------------------
   * 登录检查（温和提示 → 跳登录）
   * ------------------------ */
  checkLogin() {
    const userId = this.getUserId();
    if (!userId) {
      wx.showModal({
        title: '提示',
        content: '登录后可保存熟练度与收藏，同步学习进度。是否前往登录？',
        confirmText: '去登录',
        cancelText: '暂不',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/profile/login/login' });
          }
        }
      });
      return false;
    }
    return true;
  },
  // 打开详情弹窗
viewWordDetail(e) {
  const wordId = e.currentTarget.dataset.id;
  const word = this.data.words.find(w => w._id === wordId)
    || this.data.favoriteWords.find(w => w._id === wordId);

  if (word) {
    this.setData({
      showDetail: true,
      detailWord: word
    });
  }
},

// 关闭详情弹窗
closeDetail() {
  this.setData({ showDetail: false, detailWord: {} });
},
});
