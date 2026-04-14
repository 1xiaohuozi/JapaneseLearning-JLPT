const db = wx.cloud.database()
const _ = db.command

const PAGE_SIZE = 20
const QUERY_BATCH_SIZE = 20
const DEFAULT_SETTINGS = {
  newLimit: 20,
  reviewLimit: 40
}

const DEFAULT_SESSION_STATS = {
  reviewed: 0,
  completed: 0,
  again: 0,
  hard: 0,
  good: 0,
  newDone: 0,
  reviewDone: 0
}

Page({
  data: {
    currentTab: 'study',
    drawerOpen: false,
    drawerSection: 'overview',
    isLoggedIn: false,
    levels: ['N1', 'N2', 'N3', 'N4/N5'],
    levelIndex: 1,
    collectionMap: {
      N1: 'n1_words',
      N2: 'n2_words',
      N3: 'n3_words',
      'N4/N5': 'n4n5_words'
    },
    settings: DEFAULT_SETTINGS,
    showSettings: false,

    dashboard: {
      totalWords: 0,
      learnedWords: 0,
      dueCount: 0,
      availableNewCount: 0,
      masteredCount: 0,
      sessionSize: 0,
      reviewPlanned: 0,
      newPlanned: 0,
      learnedPercent: '0',
      learnedPercentWidth: '0%',
      finishEtaText: ''
    },
    sessionStats: {
      ...DEFAULT_SESSION_STATS
    },
    queueStats: {
      reviewRemaining: 0,
      newRemaining: 0,
      dueRemaining: 0
    },
    sessionWords: [],
    sessionIndex: 0,
    currentWord: null,
    answered: false,
    lastRating: '',
    cardFlipped: false,
    cardFlashClass: '',
    sessionLoading: false,
    sessionCompleted: false,
    sessionProgressPercent: 0,
    sessionProgressWidth: '0%',

    libraryWords: [],
    filteredLibraryWords: [],
    libraryPage: 0,
    hasMoreLibrary: true,
    loadingLibrary: false,
    libraryFilter: 'all',
    searchQuery: '',

    favoriteWords: [],
    favoritePage: 0,
    hasMoreFavorites: true,
    loadingFavorites: false,

    favMap: {},
    profMap: {},
    learnedMap: {},

    showDetail: false,
    detailWord: null
  },

  async onLoad() {
    if (!this.ensureLoggedIn()) return
    await this.loadSettings()
    await this.bootstrap()
  },

  async onShow() {
    if (!this.ensureLoggedIn()) return
    const userId = this.getUserId()
    if (userId !== this._lastUserId) {
      await this.loadSettings()
      this._lastUserId = userId
      await this.bootstrap()
    }
  },

  onHide() {
    this.persistSessionSnapshot()
  },

  onUnload() {
    this.persistSessionSnapshot()
  },

  getUserId() {
    return wx.getStorageSync('userId') || ''
  },

  ensureLoggedIn() {
    const userId = this.getUserId()
    if (userId) return true

    wx.showModal({
      title: '提示',
      content: '单词学习需要先登录，是否现在前往登录？',
      confirmText: '去登录',
      cancelText: '稍后再说',
      success: res => {
        if (res.confirm) {
          wx.navigateTo({
            url: '/pages/profile/login/login'
          })
        }
      }
    })
    return false
  },

  getCurrentCollection() {
    const level = this.data.levels[this.data.levelIndex]
    return this.data.collectionMap[level]
  },

  getSessionCacheKey() {
    const userKey = this.getUserId() || 'guest'
    return `word_session_${userKey}_${this.getCurrentCollection()}`
  },

  getTodayKey() {
    const date = new Date()
    const y = date.getFullYear()
    const m = `${date.getMonth() + 1}`.padStart(2, '0')
    const d = `${date.getDate()}`.padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  getDefaultSessionSnapshot(words = []) {
    return {
      dateKey: this.getTodayKey(),
      queueIds: words.map(word => word._id),
      currentWordId: words[0] ? words[0]._id : '',
      currentIndex: 0,
      sessionStats: { ...DEFAULT_SESSION_STATS },
      planStats: {},
      updatedAt: 0
    }
  },

  chunkList(list, size = QUERY_BATCH_SIZE) {
    const chunks = []
    for (let i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size))
    }
    return chunks
  },

  async loadSettings() {
    const cached = wx.getStorageSync('word_learning_settings')
    const nextLevelIndex = Number.isInteger(cached?.levelIndex) ? cached.levelIndex : this.data.levelIndex
    const localSettings = {
      ...DEFAULT_SETTINGS,
      ...(cached || {})
    }

    this.setData({
      levelIndex: Math.max(0, Math.min(nextLevelIndex, this.data.levels.length - 1)),
      settings: localSettings
    })

    const userId = this.getUserId()
    if (!userId) return

    try {
      const result = await this.callWordService('getUserProfile', { userId })
      if (!result.hasProfile) {
        await this.saveSettings()
        return
      }

      const profile = result.profile || {}
      const remoteLevelIndex = this.data.levels.findIndex(level => this.data.collectionMap[level] === profile.collection)
      const mergedLevelIndex = remoteLevelIndex >= 0 ? remoteLevelIndex : this.data.levelIndex
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...localSettings,
        newLimit: Number(profile.newLimit) || localSettings.newLimit,
        reviewLimit: Number(profile.reviewLimit) || localSettings.reviewLimit
      }

      this.setData({
        levelIndex: mergedLevelIndex,
        settings: mergedSettings
      })
      this.persistLocalSettings()
    } catch (error) {
      console.error('loadSettings failed', error)
    }
  },

  persistLocalSettings() {
    wx.setStorageSync('word_learning_settings', {
      ...this.data.settings,
      levelIndex: this.data.levelIndex
    })
  },

  async saveSettings() {
    this.persistLocalSettings()

    const userId = this.getUserId()
    if (!userId) return

    try {
      await this.callWordService('saveUserProfile', {
        userId,
        payload: {
          collection: this.getCurrentCollection(),
          newLimit: this.data.settings.newLimit,
          reviewLimit: this.data.settings.reviewLimit
        }
      })
    } catch (error) {
      console.error('saveSettings failed', error)
    }
  },

  async bootstrap() {
    this._lastUserId = this.getUserId()
    this.setData({ isLoggedIn: !!this._lastUserId })
    this.setData({
      showDetail: false,
      detailWord: null
    })

    if (this._lastUserId) {
      await this.saveSettings()
    }

    await Promise.all([
      this.buildSession(),
      this.resetLibrary(),
      this.resetFavorites()
    ])
  },

  async callWordService(action, payload = {}) {
    const res = await wx.cloud.callFunction({
      name: 'lafService',
      data: {
        action,
        ...payload
      }
    })

    return res.result || {}
  },

  async buildSession() {
    if (this.data.sessionLoading) return

    this.setData({ sessionLoading: true })
    const collection = this.getCurrentCollection()
    const userId = this.getUserId()

    try {
      const result = await this.callWordService('buildSession', {
        userId,
        collection,
        newLimit: this.data.settings.newLimit,
        reviewLimit: this.data.settings.reviewLimit,
        dateKey: this.getTodayKey()
      })

      const sessionWords = (result.sessionWords || []).map(word => {
        const stage = this.getWordStage(word)
        return {
          ...word,
          stage,
          stageLabel: this.getStageLabel(stage)
        }
      })
      const snapshot = await this.getPersistedSessionSnapshot(sessionWords, result.progress || null)
      const restored = this.restoreSessionFromCache(sessionWords, snapshot)
      const finalWords = restored.words
      const sessionIndex = restored.index
      const currentWord = finalWords[sessionIndex] || null
      const dashboardSource = snapshot && snapshot.planStats && Object.keys(snapshot.planStats).length
        ? snapshot.planStats
        : (result.stats || {})

      this.setData({
        sessionWords: finalWords,
        sessionIndex,
        currentWord,
        answered: false,
        lastRating: '',
        cardFlipped: false,
        cardFlashClass: '',
        sessionCompleted: finalWords.length === 0,
        sessionLoading: false,
        dashboard: {
          ...this.data.dashboard,
          ...dashboardSource,
          learnedPercent: this.computeLearnedPercent(dashboardSource),
          learnedPercentWidth: this.toPercentWidth(this.computeLearnedPercent(dashboardSource)),
          finishEtaText: this.computeFinishEta(dashboardSource)
        },
        sessionStats: restored.stats,
        queueStats: this.computeQueueStats(finalWords),
        sessionProgressPercent: this.computeSessionProgress(restored.stats, dashboardSource),
        sessionProgressWidth: this.toPercentWidth(this.computeSessionProgress(restored.stats, dashboardSource))
      })

      this.refreshMapsFromWords(finalWords)
      await this.persistSessionSnapshot({
        queueIds: finalWords.map(word => word._id),
        currentWordId: currentWord ? currentWord._id : '',
        currentIndex: sessionIndex,
        sessionStats: restored.stats,
        planStats: this.pickPlanStats(dashboardSource)
      })
    } catch (error) {
      console.error('buildSession failed', error)
      this.setData({ sessionLoading: false })
      wx.showToast({
        title: '学习任务加载失败',
        icon: 'none'
      })
    }
  },

  async getPersistedSessionSnapshot(words = [], preferredCloudSnapshot = null) {
    const fallback = this.getDefaultSessionSnapshot(words)
    const local = wx.getStorageSync(this.getSessionCacheKey())
    const todayKey = this.getTodayKey()
    const userId = this.getUserId()

    let cloudSnapshot = preferredCloudSnapshot
    if (userId) {
      if (!cloudSnapshot) {
        try {
          const result = await this.callWordService('getProgress', {
            userId,
            collection: this.getCurrentCollection(),
            dateKey: this.getTodayKey()
          })
          cloudSnapshot = result.progress || null
        } catch (error) {
          cloudSnapshot = null
        }
      }
    }

    const candidates = [local, cloudSnapshot].filter(item =>
      item &&
      item.dateKey === todayKey &&
      Array.isArray(item.queueIds)
    )

    if (!candidates.length) return fallback
    return candidates.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0]
  },

  restoreSessionFromCache(words, snapshot) {
    const fallback = {
      words,
      index: 0,
      stats: { ...DEFAULT_SESSION_STATS }
    }

    if (!snapshot || snapshot.dateKey !== this.getTodayKey() || !Array.isArray(snapshot.queueIds)) {
      return fallback
    }

    const map = new Map(words.map(word => [word._id, word]))
    const ordered = snapshot.queueIds.map(id => map.get(id)).filter(Boolean)
    const remaining = words.filter(word => !snapshot.queueIds.includes(word._id))
    const merged = ordered.concat(remaining)
    const currentIndex = Math.max(0, merged.findIndex(word => word._id === snapshot.currentWordId))

    return {
      words: merged,
      index: currentIndex >= 0 ? currentIndex : 0,
      stats: {
        ...DEFAULT_SESSION_STATS,
        ...(snapshot.sessionStats || {})
      }
    }
  },

  persistSessionSnapshot(overrides = {}) {
    const nextQueueIds = overrides.queueIds || this.data.sessionWords.map(word => word._id)
    if (!nextQueueIds.length && !this.data.sessionCompleted) {
      return Promise.resolve()
    }

    const payload = {
      dateKey: this.getTodayKey(),
      queueIds: nextQueueIds,
      currentWordId: Object.prototype.hasOwnProperty.call(overrides, 'currentWordId')
        ? overrides.currentWordId
        : (this.data.currentWord ? this.data.currentWord._id : ''),
      currentIndex: Object.prototype.hasOwnProperty.call(overrides, 'currentIndex')
        ? overrides.currentIndex
        : this.data.sessionIndex,
      sessionStats: overrides.sessionStats || this.data.sessionStats,
      planStats: overrides.planStats || this.pickPlanStats(this.data.dashboard),
      updatedAt: Date.now()
    }

    wx.setStorageSync(this.getSessionCacheKey(), payload)
    return this.persistCloudProgress(payload)
  },

  async persistCloudProgress(payload) {
    const userId = this.getUserId()
    if (!userId) return

    try {
      await this.callWordService('saveProgress', {
        userId,
        collection: this.getCurrentCollection(),
        payload: {
          ...payload,
          sessionStats: payload.sessionStats,
          completedCount: payload.sessionStats.completed || 0
        }
      })
    } catch (error) {
      console.error('saveProgress failed', error)
    }
  },

  async clearPersistedSessionSnapshot() {
    wx.removeStorageSync(this.getSessionCacheKey())

    const userId = this.getUserId()
    if (!userId) return

    try {
      await this.callWordService('clearProgress', {
        userId,
        collection: this.getCurrentCollection()
      })
    } catch (error) {
      console.error('clearProgress failed', error)
    }
  },

  pickPlanStats(dashboard) {
    return {
      totalWords: dashboard.totalWords || 0,
      learnedWords: dashboard.learnedWords || 0,
      dueCount: dashboard.dueCount || 0,
      availableNewCount: dashboard.availableNewCount || 0,
      masteredCount: dashboard.masteredCount || 0,
      sessionSize: dashboard.sessionSize || 0,
      reviewPlanned: dashboard.reviewPlanned || 0,
      newPlanned: dashboard.newPlanned || 0
    }
  },

  refreshMapsFromWords(words) {
    const favMap = { ...this.data.favMap }
    const profMap = { ...this.data.profMap }
    const learnedMap = { ...this.data.learnedMap }

    words.forEach(word => {
      favMap[word._id] = !!word.isFavorited
      profMap[word._id] = word.proficiency || 0
      learnedMap[word._id] = !!word.hasRecord
    })

    this.setData({ favMap, profMap, learnedMap })
  },

  async resetLibrary() {
    this.setData({
      libraryWords: [],
      filteredLibraryWords: [],
      libraryPage: 0,
      hasMoreLibrary: true
    })
    await this.loadMoreLibrary()
  },

  async loadMoreLibrary() {
    if (this.data.loadingLibrary || !this.data.hasMoreLibrary) return

    this.setData({ loadingLibrary: true })
    const collection = this.getCurrentCollection()

    try {
      const res = await db.collection(collection)
        .orderBy('order', 'asc')
        .skip(this.data.libraryPage * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .get()

      const enriched = await this.attachWordMeta(res.data || [])
      const libraryWords = this.data.libraryWords.concat(enriched)

      this.setData({
        libraryWords,
        libraryPage: this.data.libraryPage + 1,
        hasMoreLibrary: (res.data || []).length >= PAGE_SIZE,
        loadingLibrary: false
      })

      this.applyLibraryFilterAndSearch()
    } catch (error) {
      console.error('loadMoreLibrary failed', error)
      this.setData({ loadingLibrary: false })
    }
  },

  async attachWordMeta(words) {
    if (!words.length) return []

    const userId = this.getUserId()
    const collection = this.getCurrentCollection()
    if (!userId) {
      return words.map(word => ({
        ...word,
        proficiency: this.data.profMap[word._id] || 0,
        hasRecord: !!this.data.learnedMap[word._id],
        isFavorited: !!this.data.favMap[word._id],
        stage: this.getWordStage({
          proficiency: this.data.profMap[word._id] || 0,
          nextReview: null
        }),
        stageLabel: this.getStageLabel(this.getWordStage({
          proficiency: this.data.profMap[word._id] || 0,
          nextReview: null
        }))
      }))
    }

    const ids = words.map(word => word._id)
    const idChunks = this.chunkList(ids)

    const [favPages, profPages] = await Promise.all([
      Promise.all(
        idChunks.map(chunk =>
          db.collection('user_word_favorites')
            .where({
              user_id: userId,
              collection,
              word_id: _.in(chunk)
            })
            .field({ word_id: true })
            .get()
        )
      ),
      Promise.all(
        idChunks.map(chunk =>
          db.collection('user_word_records')
            .where({
              user_id: userId,
              collection,
              word_id: _.in(chunk)
            })
            .field({ word_id: true, proficiency: true, nextReview: true })
            .get()
        )
      )
    ])

    const favMap = { ...this.data.favMap }
    const profMap = { ...this.data.profMap }
    const learnedMap = { ...this.data.learnedMap }
    const nextMap = {}

    favPages.flatMap(res => res.data || []).forEach(item => {
      favMap[item.word_id] = true
    })

    profPages.flatMap(res => res.data || []).forEach(item => {
      profMap[item.word_id] = item.proficiency || 0
      nextMap[item.word_id] = item.nextReview || null
      learnedMap[item.word_id] = true
    })

    this.setData({ favMap, profMap, learnedMap })

    return words.map(word => ({
      ...word,
      proficiency: profMap[word._id] || 0,
      nextReview: nextMap[word._id] || null,
      hasRecord: !!learnedMap[word._id],
      isFavorited: !!favMap[word._id],
      stage: this.getWordStage({
        proficiency: profMap[word._id] || 0,
        nextReview: nextMap[word._id] || null
      }),
      stageLabel: this.getStageLabel(this.getWordStage({
        proficiency: profMap[word._id] || 0,
        nextReview: nextMap[word._id] || null
      }))
    }))
  },

  getWordStage(word) {
    if (!word.proficiency) return 'new'
    if ((word.proficiency || 0) >= 5) return 'mastered'
    if (word.nextReview && new Date(word.nextReview).getTime() <= Date.now()) return 'due'
    return 'learning'
  },

  applyLibraryFilterAndSearch() {
    const query = this.data.searchQuery.trim().toLowerCase()
    let list = this.data.libraryWords.slice()

    if (this.data.libraryFilter !== 'all') {
      list = list.filter(word => (word.stage || this.getWordStage(word)) === this.data.libraryFilter)
    }

    if (query) {
      list = list.filter(word =>
        (word.word && String(word.word).toLowerCase().includes(query)) ||
        (word.kana && String(word.kana).toLowerCase().includes(query)) ||
        (word.meaning && String(word.meaning).toLowerCase().includes(query))
      )
    }

    this.setData({ filteredLibraryWords: list })
  },

  async resetFavorites() {
    this.setData({
      favoriteWords: [],
      favoritePage: 0,
      hasMoreFavorites: true
    })

    if (this.data.currentTab === 'favorites') {
      await this.loadMoreFavorites()
    }
  },

  async loadMoreFavorites() {
    if (this.data.loadingFavorites || !this.data.hasMoreFavorites) return

    const userId = this.getUserId()
    if (!userId) {
      this.setData({
        favoriteWords: [],
        hasMoreFavorites: false
      })
      return
    }

    this.setData({ loadingFavorites: true })

    try {
      const result = await this.callWordService('getFavorites', {
        userId,
        collection: this.getCurrentCollection(),
        skip: this.data.favoritePage * PAGE_SIZE,
        limit: PAGE_SIZE
      })

      const words = await this.attachWordMeta(result.words || [])
      this.setData({
        favoriteWords: this.data.favoriteWords.concat(words),
        favoritePage: this.data.favoritePage + 1,
        hasMoreFavorites: !!result.hasMore,
        loadingFavorites: false
      })
    } catch (error) {
      console.error('loadMoreFavorites failed', error)
      this.setData({ loadingFavorites: false })
    }
  },

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings })
  },

  onNewLimitChange(e) {
    this.setData({
      'settings.newLimit': Number(e.detail.value)
    })
  },

  onReviewLimitChange(e) {
    this.setData({
      'settings.reviewLimit': Number(e.detail.value)
    })
  },

  async applySettings() {
    await this.saveSettings()
    this.setData({ showSettings: false })
    await this.clearPersistedSessionSnapshot()
    await this.buildSession()
    wx.showToast({
      title: '设置已保存',
      icon: 'success'
    })
  },

  async refreshSession() {
    await this.clearPersistedSessionSnapshot()
    this.setData({
      sessionStats: { ...DEFAULT_SESSION_STATS }
    })
    await this.buildSession()
  },

  async onLevelChange(e) {
    this.setData({
      levelIndex: Number(e.detail.value),
      showSettings: false
    })

    await this.saveSettings()
    await this.bootstrap()
  },

  async switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ currentTab: tab })

    if (tab === 'favorites' && this.data.favoriteWords.length === 0) {
      await this.loadMoreFavorites()
    }
  },

  openDrawer() {
    this.setData({ drawerOpen: true })
  },

  closeDrawer() {
    this.setData({ drawerOpen: false })
  },

  async switchDrawerSection(e) {
    const section = e.currentTarget.dataset.section
    this.setData({ drawerSection: section })

    if (section === 'favorites' && this.data.favoriteWords.length === 0) {
      await this.loadMoreFavorites()
    }
  },

  async handleDrawerScrollToLower() {
    if (this.data.drawerSection === 'library') {
      await this.loadMoreLibrary()
      return
    }

    if (this.data.drawerSection === 'favorites') {
      await this.loadMoreFavorites()
    }
  },

  onSearchInput(e) {
    this.setData({
      searchQuery: e.detail.value || ''
    })
    this.applyLibraryFilterAndSearch()
  },

  setLibraryFilter(e) {
    this.setData({
      libraryFilter: e.currentTarget.dataset.filter
    })
    this.applyLibraryFilterAndSearch()
  },

  async handleRating(e) {
    const rating = e.currentTarget.dataset.rating
    const currentWord = this.data.currentWord
    if (!currentWord) return

    const userId = this.getUserId()
    let result = {
      ok: false,
      proficiency: currentWord.proficiency || 0,
      nextReview: currentWord.nextReview || null
    }

    try {
      if (userId) {
        result = await this.callWordService('updateRecord', {
          userId,
          collection: this.getCurrentCollection(),
          word_id: currentWord._id,
          rating
        })
      } else {
        result = this.getGuestResult(currentWord, rating)
      }
    } catch (error) {
      console.error('handleRating failed', error)
      wx.showToast({
        title: '保存学习结果失败',
        icon: 'none'
      })
      return
    }

    await this.applyRatingResult(rating, result)
  },

  getGuestResult(word, rating) {
    const oldProficiency = word.proficiency || 0
    let proficiency = oldProficiency
    if (rating === 'again') {
      proficiency = Math.max(0, oldProficiency - 1)
    } else if (rating === 'good') {
      proficiency = Math.min(6, oldProficiency + 1)
    }

    return {
      ok: true,
      proficiency,
      nextReview: new Date(Date.now() + (rating === 'again' ? 10 : rating === 'hard' ? 60 : 24 * 60) * 60 * 1000)
    }
  },

  async applyRatingResult(rating, result) {
    const currentWord = this.data.currentWord
    const sessionWords = this.data.sessionWords.slice()
    const currentIndex = this.data.sessionIndex
    const updatedWord = {
      ...currentWord,
      proficiency: result.proficiency || 0,
      nextReview: result.nextReview || null,
      hasRecord: true,
      stage: this.getWordStage({
        proficiency: result.proficiency || 0,
        nextReview: result.nextReview || null
      }),
      stageLabel: this.getStageLabel(this.getWordStage({
        proficiency: result.proficiency || 0,
        nextReview: result.nextReview || null
      }))
    }

    sessionWords.splice(currentIndex, 1)

    if (rating === 'again') {
      const insertIndex = Math.min(currentIndex + 2, sessionWords.length)
      sessionWords.splice(insertIndex, 0, {
        ...updatedWord,
        sessionType: 'review'
      })
    }

    const profMap = {
      ...this.data.profMap,
      [updatedWord._id]: updatedWord.proficiency
    }
    const learnedMap = {
      ...this.data.learnedMap,
      [updatedWord._id]: true
    }
    const dashboard = this.getDashboardAfterRating(currentWord, updatedWord)

    const sessionStats = {
      ...this.data.sessionStats,
      reviewed: this.data.sessionStats.reviewed + 1,
      [rating]: this.data.sessionStats[rating] + 1
    }

    if (rating !== 'again') {
      sessionStats.completed += 1
      if (currentWord.sessionType === 'new') {
        sessionStats.newDone += 1
      } else {
        sessionStats.reviewDone += 1
      }
    }

    const nextWord = sessionWords[currentIndex] || sessionWords[currentIndex - 1] || null
    const nextIndex = nextWord ? Math.max(0, sessionWords.indexOf(nextWord)) : 0
    const flashMap = {
      again: 'flash-again',
      hard: 'flash-hard',
      good: 'flash-good'
    }

    this.patchWordAcrossLists(updatedWord)

    this.setData({
      sessionWords,
      sessionIndex: nextIndex,
      currentWord: {
        ...updatedWord,
        isFavorited: !!this.data.favMap[updatedWord._id]
      },
      answered: rating !== '',
      lastRating: rating,
      cardFlipped: true,
      cardFlashClass: flashMap[rating] || '',
      sessionCompleted: false,
      dashboard,
      sessionStats,
      queueStats: this.computeQueueStats(sessionWords),
      profMap,
      learnedMap,
      sessionProgressPercent: this.computeSessionProgress(sessionStats, dashboard),
      sessionProgressWidth: this.toPercentWidth(this.computeSessionProgress(sessionStats, dashboard))
    })

    this.autoPlayCurrentWordAudio(updatedWord)
    await this.persistSessionSnapshot({
      queueIds: sessionWords.map(word => word._id),
      currentWordId: updatedWord._id,
      currentIndex: nextIndex,
      sessionStats
    })
  },

  patchWordAcrossLists(word) {
    const patchList = list => list.map(item => item._id === word._id ? {
      ...item,
      proficiency: word.proficiency,
      nextReview: word.nextReview,
      hasRecord: word.hasRecord,
      stage: word.stage,
      stageLabel: word.stageLabel
    } : item)

    this.setData({
      libraryWords: patchList(this.data.libraryWords),
      filteredLibraryWords: patchList(this.data.filteredLibraryWords),
      favoriteWords: patchList(this.data.favoriteWords)
    })
    this.applyLibraryFilterAndSearch()
  },

  nextCard() {
    const nextWord = this.data.sessionWords[this.data.sessionIndex] || null
    this.setData({
      currentWord: nextWord,
      answered: false,
      lastRating: '',
      cardFlipped: false,
      cardFlashClass: '',
      sessionCompleted: !nextWord,
      queueStats: this.computeQueueStats(this.data.sessionWords),
      sessionProgressWidth: this.toPercentWidth(this.data.sessionProgressPercent)
    })
    this.persistSessionSnapshot({
      currentWordId: nextWord ? nextWord._id : '',
      currentIndex: this.data.sessionIndex
    })
  },

  toggleFavorite() {
    const word = this.data.detailWord || this.data.currentWord
    if (!word) return
    this.toggleFavoriteForWord(word)
  },

  async toggleFavoriteForWord(word) {
    const userId = this.getUserId()
    if (!userId) {
      this.promptLogin('收藏和同步功能需要登录后使用')
      return
    }

    try {
      const result = await this.callWordService('toggleFavorite', {
        userId,
        collection: this.getCurrentCollection(),
        word_id: word._id
      })

      const favMap = {
        ...this.data.favMap,
        [word._id]: !!result.status
      }

      this.patchFavoriteAcrossLists(word._id, !!result.status)
      this.setData({
        favMap,
        currentWord: this.data.currentWord && this.data.currentWord._id === word._id
          ? { ...this.data.currentWord, isFavorited: !!result.status }
          : this.data.currentWord,
        detailWord: this.data.detailWord && this.data.detailWord._id === word._id
          ? { ...this.data.detailWord, isFavorited: !!result.status }
          : this.data.detailWord
      })

      if (this.data.currentTab === 'favorites') {
        await this.resetFavorites()
        await this.loadMoreFavorites()
      }
    } catch (error) {
      console.error('toggleFavorite failed', error)
    }
  },

  patchFavoriteAcrossLists(wordId, isFavorited) {
    const patchList = list => list.map(item => item._id === wordId ? { ...item, isFavorited } : item)

    this.setData({
      libraryWords: patchList(this.data.libraryWords),
      filteredLibraryWords: patchList(this.data.filteredLibraryWords),
      favoriteWords: patchList(this.data.favoriteWords).filter(item => item.isFavorited),
      sessionWords: this.data.sessionWords.map(item => item._id === wordId ? { ...item, isFavorited } : item)
    })
  },

  promptLogin(content) {
    wx.showModal({
      title: '提示',
      content,
      confirmText: '去登录',
      cancelText: '稍后再说',
      success: res => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/profile/login/login' })
        }
      }
    })
  },

  playAudio(e) {
    const fileid = e.currentTarget.dataset.src
    if (!fileid) return

    wx.cloud.getTempFileURL({
      fileList: [fileid],
      success: res => {
        const tempUrl = res.fileList[0] && res.fileList[0].tempFileURL
        if (!tempUrl) return

        const innerAudioContext = wx.createInnerAudioContext()
        innerAudioContext.src = tempUrl
        innerAudioContext.play()
        innerAudioContext.onEnded(() => innerAudioContext.destroy())
        innerAudioContext.onError(() => innerAudioContext.destroy())
      }
    })
  },

  autoPlayCurrentWordAudio(word) {
    if (!word || !word.sounds || !word.sounds.length || !word.sounds[0].fileid) return
    this.playAudio({
      currentTarget: {
        dataset: {
          src: word.sounds[0].fileid
        }
      }
    })
  },

  viewWordDetail(e) {
    const wordId = e.currentTarget.dataset.id
    const word = this.findWordById(wordId)
    if (!word) return

    this.setData({
      drawerOpen: false,
      showDetail: true,
      detailWord: word
    })
  },

  closeDetail() {
    this.setData({
      showDetail: false,
      detailWord: null
    })
  },

  findWordById(wordId) {
    return this.data.sessionWords.find(word => word._id === wordId) ||
      this.data.libraryWords.find(word => word._id === wordId) ||
      this.data.favoriteWords.find(word => word._id === wordId)
  },

  startLearningThisWord() {
    const word = this.data.detailWord
    if (!word) return

    const sessionWords = this.data.sessionWords.slice()
    const existingIndex = sessionWords.findIndex(item => item._id === word._id)

    if (existingIndex === -1) {
      sessionWords.splice(this.data.sessionIndex + 1, 0, {
        ...word,
        sessionType: 'review'
      })
    }

    const currentIndex = sessionWords.findIndex(item => item._id === word._id)
    this.setData({
      currentTab: 'study',
      drawerOpen: false,
      showDetail: false,
      detailWord: null,
      sessionWords,
      sessionIndex: currentIndex >= 0 ? currentIndex : 0,
      currentWord: sessionWords[currentIndex >= 0 ? currentIndex : 0] || null,
      answered: false,
      lastRating: '',
      cardFlipped: false,
      cardFlashClass: '',
      sessionCompleted: false,
      queueStats: this.computeQueueStats(sessionWords)
    })

    this.persistSessionSnapshot({
      queueIds: sessionWords.map(item => item._id),
      currentWordId: sessionWords[currentIndex >= 0 ? currentIndex : 0]?._id || '',
      currentIndex: currentIndex >= 0 ? currentIndex : 0
    })
  },

  computeSessionProgress(stats, dashboard) {
    const base = dashboard.sessionSize || 1
    const percent = Math.min((stats.completed / base) * 100, 100)
    return percent.toFixed(0)
  },

  toPercentWidth(value) {
    return `${Number(value) || 0}%`
  },

  computeFinishEta(stats) {
    const total = Number(stats.totalWords) || 0
    const learned = Number(stats.learnedWords) || 0
    const dailyLimit = Number(this.data.settings.newLimit) || 0
    const remaining = Math.max(total - learned, 0)

    if (!remaining) return '按当前上限，预计已全部学完'
    if (!dailyLimit) return `剩余 ${remaining} 词`

    const days = Math.ceil(remaining / dailyLimit)
    return `按当前上限，预计还需 ${days} 天学完`
  },

  getDashboardAfterRating(previousWord, nextWord) {
    const dashboard = {
      ...this.data.dashboard
    }
    const wasLearned = !!previousWord.hasRecord
    const isLearned = !!nextWord.hasRecord
    const wasMastered = (previousWord.proficiency || 0) >= 5
    const isMastered = (nextWord.proficiency || 0) >= 5

    if (!wasLearned && isLearned) {
      dashboard.learnedWords += 1
    }

    if (wasMastered !== isMastered) {
      dashboard.masteredCount += isMastered ? 1 : -1
    }

    dashboard.learnedWords = Math.max(0, dashboard.learnedWords)
    dashboard.masteredCount = Math.max(0, dashboard.masteredCount)
    dashboard.learnedPercent = this.computeLearnedPercent(dashboard)
    dashboard.learnedPercentWidth = this.toPercentWidth(dashboard.learnedPercent)
    dashboard.finishEtaText = this.computeFinishEta(dashboard)
    return dashboard
  },

  computeQueueStats(words = []) {
    return words.reduce((acc, word) => {
      if (word.sessionType === 'new') {
        acc.newRemaining += 1
      } else {
        acc.reviewRemaining += 1
        acc.dueRemaining += 1
      }
      return acc
    }, {
      reviewRemaining: 0,
      newRemaining: 0,
      dueRemaining: 0
    })
  },

  computeLearnedPercent(stats) {
    const total = Number(stats.totalWords) || 0
    const learned = Number(stats.learnedWords) || 0
    if (!total) return '0'
    return Math.min((learned / total) * 100, 100).toFixed(1)
  },

  getStageLabel(stage) {
    const map = {
      new: '新词',
      learning: '学习中',
      due: '待复习',
      mastered: '已掌握'
    }
    return map[stage] || '学习中'
  },

  noop() {}
})
