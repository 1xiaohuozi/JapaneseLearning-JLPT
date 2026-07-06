const db = wx.cloud.database()
const _ = db.command
const { getWordBook, hasLocalWordBook } = require('../../utils/wordBookCache')
const { markTaskCompleted, getNextTaskSuggestion } = require('../../utils/retention')
const { getStudyPlan } = require('../../utils/studyPlan')

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

const CLOUD_PROGRESS_DEBOUNCE_MS = 12000
const RECORD_SYNC_DEBOUNCE_MS = 10000

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

    downloadingBook: false,
    downloadProgress: 0,
    downloadProgressWidth: '0%',
    downloadText: '',

    showDetail: false,
    detailWord: null
  },

  async onLoad() {
    if (this.redirectToPlanSetupIfNeeded()) return
    this.syncLoginState()
    await this.loadSettings()
    this._localSettingsSyncKey = this.getStoredSettingsSyncKey()
    await this.bootstrap()
  },

  async onShow() {
    if (this.redirectToPlanSetupIfNeeded()) return
    this.syncLoginState()
    const userId = this.getUserId()
    if (userId !== this._lastUserId) {
      await this.loadSettings()
      this._localSettingsSyncKey = this.getStoredSettingsSyncKey()
      this._lastUserId = userId
      await this.bootstrap()
      return
    }

    const nextSettingsKey = this.getStoredSettingsSyncKey()
    if (this._localSettingsSyncKey && nextSettingsKey !== this._localSettingsSyncKey) {
      await this.applyExternalSettingsChange(nextSettingsKey)
      this.handleEntryAction()
      return
    }
    this.handleEntryAction()
  },

  redirectToPlanSetupIfNeeded() {
    if (getStudyPlan().setupDone) return false
    if (this._redirectingToPlanSetup) return true

    this._redirectingToPlanSetup = true
    wx.nextTick(() => {
      wx.switchTab({ url: '/pages/profile/profile' })
    })
    return true
  },

  onHide() {
    this._redirectingToPlanSetup = false
    this.persistSessionSnapshot({ immediateCloud: true })
    this.flushPendingWordRecords()
  },

  onUnload() {
    this.persistSessionSnapshot({ immediateCloud: true })
    this.flushPendingCloudProgress()
    this.flushPendingWordRecords()
  },

  getUserId() {
    return wx.getStorageSync('userId') || ''
  },

  syncLoginState() {
    const isLoggedIn = !!this.getUserId()
    if (this.data.isLoggedIn !== isLoggedIn) {
      this.setData({ isLoggedIn })
    }
    return isLoggedIn
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

  getPendingRecordCacheKey() {
    const userKey = this.getUserId() || 'guest'
    return `word_pending_records_${userKey}_${this.getCurrentCollection()}`
  },

  async ensureActiveWordBook() {
    const collection = this.getCurrentCollection()
    if (this._activeWordBook && this._activeWordBookCollection === collection) {
      return this._activeWordBook
    }

    const label = this.data.levels[this.data.levelIndex] || collection
    const book = await getWordBook(collection, {
      onProgress: payload => this.handleBookDownloadProgress(label, payload)
    })
    this._activeWordBook = book
    this._activeWordBookCollection = collection
    this.setData({
      downloadingBook: false,
      downloadProgress: 0,
      downloadProgressWidth: '0%',
      downloadText: ''
    })
    return book
  },

  hasLocalWordBook() {
    return hasLocalWordBook(this.getCurrentCollection())
  },

  getActiveWordList() {
    return this._activeWordBook?.list || []
  },

  getActiveWordById(wordId) {
    return this._activeWordBook?.byId?.[wordId] || null
  },

  handleBookDownloadProgress(label, payload = {}) {
    const phaseMap = {
      preparing: '准备下载',
      downloading: '正在下载',
      saving: '正在保存',
      parsing: '正在解析',
      'reading-cache': '正在读取本地缓存'
    }
    const progress = Math.max(0, Math.min(100, Number(payload.progress || 0)))
    const phaseText = phaseMap[payload.phase] || '正在加载'
    this.setData({
      downloadingBook: true,
      downloadProgress: progress,
      downloadProgressWidth: `${progress}%`,
      downloadText: `${label} 词书${phaseText} ${progress}%`
    })
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
    const preferLocalPlan = cached?.planSource === 'study_plan'
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
        newLimit: preferLocalPlan ? localSettings.newLimit : (Number(profile.newLimit) || localSettings.newLimit),
        reviewLimit: preferLocalPlan ? localSettings.reviewLimit : (Number(profile.reviewLimit) || localSettings.reviewLimit)
      }

      this.setData({
        levelIndex: preferLocalPlan ? this.data.levelIndex : mergedLevelIndex,
        settings: mergedSettings
      })
      this.markProfileSynced({
        collection: this.getCurrentCollection(),
        newLimit: mergedSettings.newLimit,
        reviewLimit: mergedSettings.reviewLimit
      })
      this.persistLocalSettings()
      if (preferLocalPlan) {
        await this.saveSettings({ force: true })
      }
    } catch (error) {
      console.error('loadSettings failed', error)
    }
  },

  getStoredSettingsSyncKey() {
    const cached = wx.getStorageSync('word_learning_settings') || {}
    const levelIndex = Number.isInteger(cached.levelIndex) ? cached.levelIndex : this.data.levelIndex
    return JSON.stringify({
      levelIndex,
      newLimit: Number(cached.newLimit) || DEFAULT_SETTINGS.newLimit,
      reviewLimit: Number(cached.reviewLimit) || DEFAULT_SETTINGS.reviewLimit,
      planUpdatedAt: Number(cached.planUpdatedAt) || 0
    })
  },

  async applyExternalSettingsChange(nextSettingsKey) {
    await this.flushPendingWordRecords()
    await this.loadSettings()
    this._localSettingsSyncKey = nextSettingsKey || this.getStoredSettingsSyncKey()
    await this.clearPersistedSessionSnapshot()
    this.setData({
      sessionCompleted: false,
      sessionWords: [],
      currentWord: null,
      sessionIndex: 0,
      sessionStats: { ...DEFAULT_SESSION_STATS },
      queueStats: {
        reviewRemaining: 0,
        newRemaining: 0,
        dueRemaining: 0
      },
      libraryWords: [],
      filteredLibraryWords: [],
      libraryPage: 0,
      hasMoreLibrary: true,
      favoriteWords: [],
      favoritePage: 0,
      hasMoreFavorites: true
    })
    await this.bootstrap()
  },

  persistLocalSettings() {
    wx.setStorageSync('word_learning_settings', {
      ...this.data.settings,
      levelIndex: this.data.levelIndex
    })
  },

  getProfilePayload() {
    return {
      collection: this.getCurrentCollection(),
      newLimit: Number(this.data.settings.newLimit) || DEFAULT_SETTINGS.newLimit,
      reviewLimit: Number(this.data.settings.reviewLimit) || DEFAULT_SETTINGS.reviewLimit
    }
  },

  getProfileSyncKey(payload = this.getProfilePayload()) {
    return JSON.stringify(payload)
  },

  markProfileSynced(payload = this.getProfilePayload()) {
    this._profileSyncKey = this.getProfileSyncKey(payload)
  },

  async saveSettings(options = {}) {
    this.persistLocalSettings()

    const userId = this.getUserId()
    if (!userId) return

    const payload = this.getProfilePayload()
    const nextSyncKey = this.getProfileSyncKey(payload)
    if (!options.force && nextSyncKey === this._profileSyncKey) return

    try {
      await this.callWordService('saveUserProfile', {
        userId,
        payload
      })
      this.markProfileSynced(payload)
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

    await this.ensureActiveWordBook()

    if (this._lastUserId) {
      await this.saveSettings()
    }

    await Promise.all([
      this.buildSession(),
      this.resetLibrary(),
      this.resetFavorites()
    ])
  },

  loadPendingRecordQueue() {
    const queue = wx.getStorageSync(this.getPendingRecordCacheKey())
    this._pendingRecordQueue = Array.isArray(queue) ? queue : []
    return this._pendingRecordQueue
  },

  persistPendingRecordQueue() {
    const queue = Array.isArray(this._pendingRecordQueue) ? this._pendingRecordQueue : []
    if (!queue.length) {
      wx.removeStorageSync(this.getPendingRecordCacheKey())
      return
    }
    wx.setStorageSync(this.getPendingRecordCacheKey(), queue)
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

    this._wordSessionRecapShown = false
    this._weakWordMap = {}
    this.setData({ sessionLoading: true })
    const collection = this.getCurrentCollection()
    const userId = this.getUserId()
    const activeBook = await this.ensureActiveWordBook()
    const useLocalContent = activeBook.mode === 'local'

    try {
      await this.flushPendingWordRecords()
      const result = await this.callWordService('buildSession', {
        userId,
        collection,
        newLimit: this.data.settings.newLimit,
        reviewLimit: this.data.settings.reviewLimit,
        dateKey: this.getTodayKey(),
        contentMode: useLocalContent ? 'local' : 'cloud',
        totalWordsHint: useLocalContent ? activeBook.list.length : 0
      })

      const sourceWords = useLocalContent
        ? this.hydrateLocalSessionWords(result.sessionEntries || [])
        : (result.sessionWords || [])
      const sessionWords = sourceWords.map(word => {
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

    const candidates = [local, cloudSnapshot].filter(item => {
      if (!item || item.dateKey !== todayKey || !Array.isArray(item.queueIds)) {
        return false
      }
      return item.queueIds.length > 0 || words.length === 0
    })

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

  hydrateLocalSessionWords(entries = []) {
    return entries
      .map(entry => {
        const baseWord = this.getActiveWordById(entry.word_id || entry._id)
        if (!baseWord) return null
        return {
          ...baseWord,
          proficiency: entry.proficiency || 0,
          stability: entry.stability || 0,
          nextReview: entry.nextReview || null,
          hasRecord: !!entry.hasRecord,
          isFavorited: !!entry.isFavorited,
          sessionType: entry.sessionType || 'new'
        }
      })
      .filter(Boolean)
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
    if (overrides.immediateCloud) {
      return this.persistCloudProgress(payload)
    }
    this.scheduleCloudProgressSync(payload)
    return Promise.resolve()
  },

  scheduleCloudProgressSync(payload) {
    this._pendingCloudProgress = payload
    if (this._progressSyncTimer) return

    this._progressSyncTimer = setTimeout(() => {
      this._progressSyncTimer = null
      const nextPayload = this._pendingCloudProgress
      this._pendingCloudProgress = null
      if (nextPayload) {
        this.persistCloudProgress(nextPayload)
      }
    }, CLOUD_PROGRESS_DEBOUNCE_MS)
  },

  flushPendingCloudProgress() {
    if (this._progressSyncTimer) {
      clearTimeout(this._progressSyncTimer)
      this._progressSyncTimer = null
    }

    const payload = this._pendingCloudProgress
    this._pendingCloudProgress = null
    if (payload) {
      return this.persistCloudProgress(payload)
    }
    return Promise.resolve()
  },

  enqueuePendingWordRecord(payload) {
    this.loadPendingRecordQueue()
    this._pendingRecordQueue.push({
      ...payload,
      queuedAt: Date.now()
    })
    this.persistPendingRecordQueue()
    this.schedulePendingWordRecordFlush()
  },

  schedulePendingWordRecordFlush() {
    if (this._recordSyncTimer) return

    this._recordSyncTimer = setTimeout(() => {
      this._recordSyncTimer = null
      this.flushPendingWordRecords()
    }, RECORD_SYNC_DEBOUNCE_MS)
  },

  async flushPendingWordRecords() {
    const userId = this.getUserId()
    if (!userId) return

    this.loadPendingRecordQueue()
    if (!this._pendingRecordQueue.length) return

    if (this._recordSyncTimer) {
      clearTimeout(this._recordSyncTimer)
      this._recordSyncTimer = null
    }

    const queue = this._pendingRecordQueue.slice()
    this._pendingRecordQueue = []
    this.persistPendingRecordQueue()

    try {
      await this.callWordService('batchUpdateRecords', {
        userId,
        collection: this.getCurrentCollection(),
        records: queue.map(item => ({
          word_id: item.word_id,
          rating: item.rating,
          word_order: item.word_order || 0,
          session_type: item.session_type || ''
        }))
      })
    } catch (error) {
      this._pendingRecordQueue = queue.concat(this._pendingRecordQueue || [])
      this.persistPendingRecordQueue()
      console.error('flushPendingWordRecords failed', error)
    }
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
    if (this._recordSyncTimer) {
      clearTimeout(this._recordSyncTimer)
      this._recordSyncTimer = null
    }
    this._pendingRecordQueue = []
    wx.removeStorageSync(this.getPendingRecordCacheKey())

    if (this._progressSyncTimer) {
      clearTimeout(this._progressSyncTimer)
      this._progressSyncTimer = null
    }
    this._pendingCloudProgress = null
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
  },

  async loadMoreLibrary() {
    if (this.data.loadingLibrary || !this.data.hasMoreLibrary) return

    this.setData({ loadingLibrary: true })

    try {
      let sourceWords = []
      if (this.hasLocalWordBook()) {
        await this.ensureActiveWordBook()
        const start = this.data.libraryPage * PAGE_SIZE
        sourceWords = this.getActiveWordList().slice(start, start + PAGE_SIZE)
      } else {
        const res = await db.collection(this.getCurrentCollection())
          .orderBy('order', 'asc')
          .skip(this.data.libraryPage * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .get()
        sourceWords = res.data || []
      }

      const enriched = await this.attachWordMeta(sourceWords)
      const libraryWords = this.data.libraryWords.concat(enriched)

      this.setData({
        libraryWords,
        libraryPage: this.data.libraryPage + 1,
        hasMoreLibrary: sourceWords.length >= PAGE_SIZE,
        loadingLibrary: false
      })

      this.applyLibraryFilterAndSearch()
    } catch (error) {
      console.error('loadMoreLibrary failed', error)
      this.setData({ loadingLibrary: false })
    }
  },

  async attachWordMeta(words, options = {}) {
    if (!words.length) return []

    const userId = this.getUserId()
    const collection = this.getCurrentCollection()
    const forceFavorited = !!options.forceFavorited
    if (!userId) {
      return words.map(word => ({
        ...word,
        proficiency: this.data.profMap[word._id] || 0,
        hasRecord: !!this.data.learnedMap[word._id],
        isFavorited: forceFavorited || !!this.data.favMap[word._id],
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

    const favMap = { ...this.data.favMap }
    const profMap = { ...this.data.profMap }
    const learnedMap = { ...this.data.learnedMap }
    const nextMap = {}

    const missingRecordIds = words
      .map(word => word._id)
      .filter(id => !Object.prototype.hasOwnProperty.call(profMap, id) && !Object.prototype.hasOwnProperty.call(learnedMap, id))

    const missingFavoriteIds = forceFavorited
      ? []
      : words
        .map(word => word._id)
        .filter(id => !Object.prototype.hasOwnProperty.call(favMap, id))

    if (missingFavoriteIds.length) {
      const favPages = await Promise.all(
        this.chunkList(missingFavoriteIds).map(chunk =>
          db.collection('user_word_favorites')
            .where({
              user_id: userId,
              collection,
              word_id: _.in(chunk)
            })
            .field({ word_id: true })
            .get()
        )
      )

      missingFavoriteIds.forEach(id => {
        if (!Object.prototype.hasOwnProperty.call(favMap, id)) {
          favMap[id] = false
        }
      })

      favPages.flatMap(res => res.data || []).forEach(item => {
        favMap[item.word_id] = true
      })
    }

    if (missingRecordIds.length) {
      const profPages = await Promise.all(
        this.chunkList(missingRecordIds).map(chunk =>
          db.collection('user_word_records')
            .where({
              user_id: userId,
              collection,
              word_id: _.in(chunk)
            })
            .field({ word_id: true, proficiency: true, nextReview: true, stability: true })
            .get()
        )
      )

      missingRecordIds.forEach(id => {
        if (!Object.prototype.hasOwnProperty.call(profMap, id)) profMap[id] = 0
        if (!Object.prototype.hasOwnProperty.call(learnedMap, id)) learnedMap[id] = false
      })

      profPages.flatMap(res => res.data || []).forEach(item => {
        profMap[item.word_id] = item.proficiency || 0
        nextMap[item.word_id] = item.nextReview || null
        learnedMap[item.word_id] = true
      })
    }

    this.setData({ favMap, profMap, learnedMap })

    return words.map(word => ({
      ...word,
      proficiency: profMap[word._id] || 0,
      nextReview: Object.prototype.hasOwnProperty.call(nextMap, word._id)
        ? nextMap[word._id]
        : (word.nextReview || null),
      hasRecord: !!learnedMap[word._id],
      isFavorited: forceFavorited || !!favMap[word._id],
      stage: this.getWordStage({
        proficiency: profMap[word._id] || 0,
        nextReview: Object.prototype.hasOwnProperty.call(nextMap, word._id)
          ? nextMap[word._id]
          : (word.nextReview || null)
      }),
      stageLabel: this.getStageLabel(this.getWordStage({
        proficiency: profMap[word._id] || 0,
        nextReview: Object.prototype.hasOwnProperty.call(nextMap, word._id)
          ? nextMap[word._id]
          : (word.nextReview || null)
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
        limit: PAGE_SIZE,
        contentMode: this.hasLocalWordBook() ? 'local' : 'cloud'
      })

      const sourceWords = this.hasLocalWordBook()
        ? (result.wordIds || []).map(id => this.getActiveWordById(id)).filter(Boolean)
        : (result.words || [])
      const words = await this.attachWordMeta(sourceWords, { forceFavorited: true })
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
    await this.flushPendingWordRecords()
    await this.clearPersistedSessionSnapshot()
    await this.buildSession()
    wx.showToast({
      title: '设置已保存',
      icon: 'success'
    })
  },

  async refreshSession() {
    await this.flushPendingWordRecords()
    await this.clearPersistedSessionSnapshot()
    this.setData({
      sessionStats: { ...DEFAULT_SESSION_STATS }
    })
    await this.buildSession()
  },

  async onLevelChange(e) {
    await this.flushPendingWordRecords()
    this.setData({
      levelIndex: Number(e.detail.value),
      showSettings: false
    })

    await this.saveSettings()
    await this.clearPersistedSessionSnapshot()
    this.setData({
      sessionCompleted: false,
      sessionWords: [],
      currentWord: null,
      sessionIndex: 0,
      sessionStats: { ...DEFAULT_SESSION_STATS },
      queueStats: {
        reviewRemaining: 0,
        newRemaining: 0,
        dueRemaining: 0
      }
    })
    await this.bootstrap()
  },

  openSettingsPanel() {
    this.setData({
      drawerOpen: true,
      drawerSection: 'settings',
      showSettings: true
    })
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

  handleEntryAction() {
    const action = wx.getStorageSync('word_learning_entry_action')
    if (!action || action.type !== 'weak') return
    wx.removeStorageSync('word_learning_entry_action')
    this.openWeakWordDrawer()
  },

  async openWeakWordDrawer() {
    this.setData({
      drawerOpen: true,
      drawerSection: 'library',
      libraryFilter: 'learning'
    })
    if (!this.data.libraryWords.length) {
      await this.loadMoreLibrary()
    } else {
      this.applyLibraryFilterAndSearch()
    }
  },

  closeDrawer() {
    this.setData({ drawerOpen: false })
  },

  async switchDrawerSection(e) {
    const section = e.currentTarget.dataset.section
    this.setData({ drawerSection: section })

    if (section === 'favorites' && this.data.favoriteWords.length === 0) {
      await this.loadMoreFavorites()
      return
    }

    if (section === 'library' && this.data.libraryWords.length === 0) {
      await this.loadMoreLibrary()
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

    let result = this.getPredictedRecordResult(currentWord, rating)

    try {
      if (this.getUserId()) {
        this.enqueuePendingWordRecord({
          word_id: currentWord._id,
          rating,
          word_order: currentWord.order || 0,
          session_type: currentWord.sessionType || ''
        })
      }
    } catch (error) {
      console.error('handleRating failed', error)
      wx.showToast({
        title: '保存学习结果失败',
        icon: 'none'
      })
    }

    await this.applyRatingResult(rating, result)
  },

  getPredictedRecordResult(word, rating) {
    const oldProficiency = word.proficiency || 0
    const oldStability = Number(word.stability || 0.6)
    let proficiency = oldProficiency
    if (rating === 'again') {
      proficiency = Math.max(0, oldProficiency - 1)
    } else if (rating === 'hard') {
      proficiency = Math.max(0, oldProficiency)
    } else if (rating === 'good') {
      proficiency = Math.min(6, oldProficiency + 1)
    }

    const byRating = {
      again: [10, 15, 30, 60, 120, 240],
      hard: [30, 360, 720, 1440, 2880, 5760],
      good: [720, 1440, 4320, 7200, 10080, 20160]
    }
    const table = byRating[rating] || byRating.good
    const index = Math.max(0, Math.min(proficiency, table.length - 1))
    const scheduledMinutes = table[index]
    const stabilityMultiplier = rating === 'again' ? 0.6 : rating === 'hard' ? 1.05 : 1.6
    const stabilityBonus = rating === 'again' ? 0.1 : rating === 'hard' ? 0.25 : 0.6
    const stability = Math.max(0.2, oldStability * stabilityMultiplier + stabilityBonus)
    const intervalMs = Math.max(scheduledMinutes * 60 * 1000, Math.round(stability * 60 * 60 * 1000))

    return {
      ok: true,
      proficiency,
      stability,
      intervalMs,
      nextReview: new Date(Date.now() + intervalMs)
    }
  },

  async applyRatingResult(rating, result) {
    const currentWord = this.data.currentWord
    const sessionWords = this.data.sessionWords.slice()
    const currentIndex = this.data.sessionIndex
    const updatedWord = {
      ...currentWord,
      proficiency: result.proficiency || 0,
      stability: result.stability || currentWord.stability || 0,
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

    if (rating === 'again' || rating === 'hard') {
      this._weakWordMap = {
        ...(this._weakWordMap || {}),
        [updatedWord._id]: {
          ...updatedWord,
          sessionType: 'review'
        }
      }
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
      stability: word.stability,
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
    const completedNow = !nextWord
    this.setData({
      currentWord: nextWord,
      answered: false,
      lastRating: '',
      cardFlipped: false,
      cardFlashClass: '',
      sessionCompleted: completedNow,
      queueStats: this.computeQueueStats(this.data.sessionWords),
      sessionProgressWidth: this.toPercentWidth(this.data.sessionProgressPercent)
    })
    this.persistSessionSnapshot({
      currentWordId: nextWord ? nextWord._id : '',
      currentIndex: this.data.sessionIndex
    })
    if (completedNow) {
      this.showSessionRecap()
    }
  },

  showSessionRecap() {
    if (this._wordSessionRecapShown || !this.data.sessionStats.completed) return
    this._wordSessionRecapShown = true

    const stats = this.data.sessionStats
    markTaskCompleted('word', {
      text: `完成 ${stats.completed} 张卡片`,
      completed: stats.completed,
      again: stats.again,
      hard: stats.hard,
      good: stats.good
    })

    wx.showModal({
      title: '今日单词已完成',
      content: `本轮完成 ${stats.completed} 个，认识 ${stats.good} 个，模糊 ${stats.hard} 个，回炉 ${stats.again} 个。接下来可以回到今日学习台，也可以继续加练。`,
      confirmText: '选择下一步',
      showCancel: false,
      success: () => this.showWordNextActions()
    })
  },

  showWordNextActions() {
    const weakCount = Object.keys(this._weakWordMap || {}).length
    const nextTask = getNextTaskSuggestion('word')
    wx.showActionSheet({
      itemList: [
        nextTask.label,
        '状态不错，再来一轮',
        weakCount ? `复习薄弱词 ${weakCount} 个` : '查看词库'
      ],
      success: res => {
        if (res.tapIndex === 0) {
          this.goToSuggestedTask(nextTask)
          return
        }
        if (res.tapIndex === 1) {
          this.refreshSession()
          return
        }
        if (weakCount) {
          this.startWeakWordReview()
        } else {
          this.setData({ drawerOpen: true, drawerSection: 'library' })
          if (!this.data.libraryWords.length) this.loadMoreLibrary()
        }
      }
    })
  },

  goToSuggestedTask(nextTask) {
    if (!nextTask || !nextTask.hasNext || !nextTask.task) {
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    if (nextTask.task.key === 'word') {
      this.refreshSession()
      return
    }
    wx.switchTab({ url: nextTask.task.route })
  },

  startWeakWordReview() {
    const weakWords = Object.values(this._weakWordMap || {})
    if (!weakWords.length) return

    this.setData({
      sessionWords: weakWords,
      sessionIndex: 0,
      currentWord: weakWords[0],
      answered: false,
      lastRating: '',
      cardFlipped: false,
      cardFlashClass: '',
      sessionCompleted: false,
      sessionStats: { ...DEFAULT_SESSION_STATS },
      queueStats: this.computeQueueStats(weakWords),
      sessionProgressPercent: 0,
      sessionProgressWidth: '0%'
    })
    this._weakWordMap = {}
    this.persistSessionSnapshot({
      queueIds: weakWords.map(word => word._id),
      currentWordId: weakWords[0]._id,
      currentIndex: 0,
      sessionStats: { ...DEFAULT_SESSION_STATS }
    })
  },

  toggleFavorite() {
    const word = this.data.detailWord || this.data.currentWord
    if (!word) return
    this.toggleFavoriteForWord(word)
  },

  buildWordMetaSnapshot(word, isFavorited) {
    const proficiency = Number(this.data.profMap[word._id] || word.proficiency || 0)
    const nextReview = word.nextReview || null
    const stage = this.getWordStage({ proficiency, nextReview })
    return {
      ...word,
      proficiency,
      nextReview,
      hasRecord: !!this.data.learnedMap[word._id] || !!word.hasRecord,
      isFavorited: !!isFavorited,
      stage,
      stageLabel: this.getStageLabel(stage)
    }
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

      this.patchFavoriteAcrossLists(word, !!result.status)
      this.setData({
        favMap,
        currentWord: this.data.currentWord && this.data.currentWord._id === word._id
          ? { ...this.data.currentWord, isFavorited: !!result.status }
          : this.data.currentWord,
        detailWord: this.data.detailWord && this.data.detailWord._id === word._id
          ? { ...this.data.detailWord, isFavorited: !!result.status }
          : this.data.detailWord
      })

      if (this.data.currentTab === 'favorites' || this.data.drawerSection === 'favorites') {
        await this.resetFavorites()
        await this.loadMoreFavorites()
      }
    } catch (error) {
      console.error('toggleFavorite failed', error)
    }
  },

  patchFavoriteAcrossLists(word, isFavorited) {
    const wordId = word._id
    const patchList = list => list.map(item => item._id === wordId ? { ...item, isFavorited } : item)
    const patchedFavorites = patchList(this.data.favoriteWords).filter(item => item.isFavorited)
    const favoriteExists = patchedFavorites.some(item => item._id === wordId)
    const nextFavoriteWords = isFavorited && !favoriteExists
      ? [this.buildWordMetaSnapshot(word, true), ...patchedFavorites]
      : patchedFavorites

    this.setData({
      libraryWords: patchList(this.data.libraryWords),
      filteredLibraryWords: patchList(this.data.filteredLibraryWords),
      favoriteWords: nextFavoriteWords,
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
      this.data.favoriteWords.find(word => word._id === wordId) ||
      this.getActiveWordById(wordId)
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
