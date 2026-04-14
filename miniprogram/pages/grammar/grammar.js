const db = wx.cloud.database()
const _ = db.command

const SETTINGS_KEY = 'grammar_learning_settings'
const RECORDS_COLLECTION = 'user_study_records'
const FAVORITES_COLLECTION = 'user_favorites'
const PAGE_SIZE = 12
const BATCH_SIZE = 20

const COLLECTIONS = [
  { key: 'n1_grammar', label: 'N1', theme: 'summit' },
  { key: 'n2_grammar', label: 'N2', theme: 'ocean' },
  { key: 'n3_grammar', label: 'N3', theme: 'forest' },
  { key: 'n4n5_grammar', label: 'N4/N5', theme: 'sunrise' }
]

function getDefaultCollectionKey() {
  return COLLECTIONS[1].key
}

function getCollectionConfig(collectionKey) {
  return COLLECTIONS.find((item) => item.key === collectionKey) || COLLECTIONS[1]
}

function getSafeDateString(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

Page({
  data: {
    collections: COLLECTIONS,
    currentCollection: getDefaultCollectionKey(),
    currentCollectionLabel: getCollectionConfig(getDefaultCollectionKey()).label,
    currentTheme: getCollectionConfig(getDefaultCollectionKey()).theme,
    mode: 'order',
    grammarList: [],
    userRecords: {},
    favoriteMap: {},
    currentPage: 1,
    hasMore: true,
    loading: false,
    loadingText: '',
    searchText: '',
    showMeaning: true,
    showModal: false,
    currentGrammar: null,
    currentProficiency: 0,
    currentRecordId: '',
    isFavorite: false,
    isLoggedIn: false,
    userId: '',
    stats: {
      total: 0,
      learned: 0,
      mastered: 0,
      favorites: 0,
      percent: '0.0'
    }
  },

  onLoad(options) {
    const settings = this.loadSettings()
    const collectionFromOptions = options.collection
    const collectionKey = this.normalizeCollection(collectionFromOptions || settings.collectionKey)
    const showMeaning = typeof settings.showMeaning === 'boolean' ? settings.showMeaning : true
    const mode = settings.mode === 'random' ? 'random' : 'order'
    const searchText = options.search ? decodeURIComponent(options.search) : ''

    this.setCollectionState(collectionKey, { showMeaning, mode, searchText })
    this.bootstrap(options)
  },

  async onShow() {
    await this.refreshLoginState()
    if (this.data.isLoggedIn) {
      await this.loadCollectionMeta()
    }
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore && this.data.mode === 'order') {
      this.loadMore()
    }
  },

  onPullDownRefresh() {
    this.reloadPage().finally(() => wx.stopPullDownRefresh())
  },

  loadSettings() {
    return wx.getStorageSync(SETTINGS_KEY) || {}
  },

  saveSettings(extra = {}) {
    const prev = this.loadSettings()
    wx.setStorageSync(SETTINGS_KEY, {
      ...prev,
      collectionKey: this.data.currentCollection,
      showMeaning: this.data.showMeaning,
      mode: this.data.mode,
      ...extra
    })
  },

  normalizeCollection(collectionKey) {
    return getCollectionConfig(collectionKey).key
  },

  setCollectionState(collectionKey, extra = {}) {
    const config = getCollectionConfig(collectionKey)
    this.setData({
      currentCollection: config.key,
      currentCollectionLabel: config.label,
      currentTheme: config.theme,
      ...extra
    })
  },

  async bootstrap(options = {}) {
    await this.refreshLoginState()
    if (options.grammar_id) {
      this._pendingGrammarId = Number(options.grammar_id)
    }
    await this.reloadPage()
  },

  async refreshLoginState() {
    const app = getApp()
    const cachedId = app.globalData.userId || wx.getStorageSync('userId') || ''
    if (cachedId) {
      app.globalData.userId = cachedId
      this.setData({ isLoggedIn: true, userId: cachedId })
      return true
    }
    this.setData({ isLoggedIn: false, userId: '' })
    return false
  },

  buildRecordFilter(ids) {
    const base = {
      user_id: this.data.userId,
      grammar_id: _.in(ids)
    }
    return base
  },

  filterByCollection(records, collectionKey = this.data.currentCollection) {
    return (records || []).filter((item) => {
      if (item.collection) return item.collection === collectionKey
      return collectionKey === 'n2_grammar'
    })
  },

  async fetchCollectionCount(collectionKey) {
    const { total } = await db.collection(collectionKey).count()
    return total
  },

  async getAllUserRecordsForCollection(collectionKey = this.data.currentCollection) {
    if (!this.data.userId) return []
    const countRes = await db.collection(RECORDS_COLLECTION).where({ user_id: this.data.userId }).count()
    const total = countRes.total || 0
    if (!total) return []
    const tasks = []
    const batchTimes = Math.ceil(total / BATCH_SIZE)
    for (let i = 0; i < batchTimes; i += 1) {
      tasks.push(
        db
          .collection(RECORDS_COLLECTION)
          .where({ user_id: this.data.userId })
          .skip(i * BATCH_SIZE)
          .limit(BATCH_SIZE)
          .get()
      )
    }
    const results = await Promise.all(tasks)
    return this.filterByCollection(results.flatMap((res) => res.data), collectionKey)
  },

  async getAllFavoritesForCollection(collectionKey = this.data.currentCollection) {
    if (!this.data.userId) return []
    const countRes = await db.collection(FAVORITES_COLLECTION).where({ user_id: this.data.userId }).count()
    const total = countRes.total || 0
    if (!total) return []
    const tasks = []
    const batchTimes = Math.ceil(total / BATCH_SIZE)
    for (let i = 0; i < batchTimes; i += 1) {
      tasks.push(
        db
          .collection(FAVORITES_COLLECTION)
          .where({ user_id: this.data.userId })
          .skip(i * BATCH_SIZE)
          .limit(BATCH_SIZE)
          .get()
      )
    }
    const results = await Promise.all(tasks)
    return this.filterByCollection(results.flatMap((res) => res.data), collectionKey)
  },

  async loadCollectionMeta() {
    const [total, records, favorites] = await Promise.all([
      this.fetchCollectionCount(this.data.currentCollection),
      this.getAllUserRecordsForCollection(this.data.currentCollection),
      this.getAllFavoritesForCollection(this.data.currentCollection)
    ])

    const recordMap = {}
    let mastered = 0
    records.forEach((item) => {
      const grammarId = Number(item.grammar_id)
      recordMap[grammarId] = item
      if ((item.proficiency || 0) >= 4) mastered += 1
    })

    const favoriteMap = {}
    favorites.forEach((item) => {
      favoriteMap[Number(item.grammar_id)] = item
    })

    this.setData({
      userRecords: recordMap,
      favoriteMap,
      stats: {
        total,
        learned: records.length,
        mastered,
        favorites: favorites.length,
        percent: total ? ((records.length / total) * 100).toFixed(1) : '0.0'
      }
    })
  },

  async loadGrammarList() {
    if (this.data.loading) return
    this.setData({ loading: true, loadingText: '加载语法中...' })

    try {
      let query = db.collection(this.data.currentCollection)
      if (this.data.searchText) {
        const regExp = db.RegExp({
          regexp: this.data.searchText,
          options: 'i'
        })
        query = query.where(
          _.or([
            { title: regExp },
            { meaning: regExp },
            { note: regExp },
            { grammar_id: regExp }
          ])
        )
      }

      if (this.data.mode === 'random') {
        const countRes = await query.count()
        const total = countRes.total || 0
        if (!total) {
          this.setData({ grammarList: [], hasMore: false, loading: false })
          return
        }
        const need = Math.min(PAGE_SIZE, total)
        const indexes = new Set()
        while (indexes.size < need) indexes.add(Math.floor(Math.random() * total))
        const results = await Promise.all(
          Array.from(indexes).map((index) => query.skip(index).limit(1).get())
        )
        this.setData({
          grammarList: results.map((item) => item.data[0]).filter(Boolean),
          hasMore: false,
          loading: false
        })
      } else {
        const res = await query
          .orderBy('grammar_id', 'asc')
          .skip((this.data.currentPage - 1) * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .get()

        const grammarList =
          this.data.currentPage === 1 ? res.data : this.data.grammarList.concat(res.data)

        this.setData({
          grammarList,
          hasMore: res.data.length === PAGE_SIZE,
          loading: false
        })
      }

      if (this._pendingGrammarId) {
        const pendingId = this._pendingGrammarId
        this._pendingGrammarId = null
        await this.showGrammarDetailById(pendingId)
      }
    } catch (error) {
      console.error('loadGrammarList failed', error)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async reloadPage() {
    this.setData({
      grammarList: [],
      currentPage: 1,
      hasMore: true,
      showModal: false,
      currentGrammar: null
    })
    if (this.data.isLoggedIn) {
      await this.loadCollectionMeta()
    } else {
      this.setData({
        userRecords: {},
        favoriteMap: {},
        stats: {
          total: await this.fetchCollectionCount(this.data.currentCollection),
          learned: 0,
          mastered: 0,
          favorites: 0,
          percent: '0.0'
        }
      })
    }
    await this.loadGrammarList()
  },

  loadMore() {
    this.setData({ currentPage: this.data.currentPage + 1 }, () => this.loadGrammarList())
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) return
    this.setData({ mode, currentPage: 1, grammarList: [], hasMore: true }, async () => {
      this.saveSettings()
      await this.loadGrammarList()
    })
  },

  onSearchInput(e) {
    const searchText = (e.detail.value || '').trim()
    this.setData({ searchText, currentPage: 1, grammarList: [], hasMore: true })
    clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => this.loadGrammarList(), 250)
  },

  clearSearch() {
    this.setData({ searchText: '', currentPage: 1, grammarList: [], hasMore: true }, () =>
      this.loadGrammarList()
    )
  },

  async switchCollection(e) {
    const collectionKey = this.normalizeCollection(e.currentTarget.dataset.collection)
    if (collectionKey === this.data.currentCollection) return
    this.setCollectionState(collectionKey)
    this.saveSettings({ collectionKey })
    await this.reloadPage()
  },

  toggleMeaning(e) {
    const showMeaning = !!e.detail.value
    this.setData({ showMeaning })
    this.saveSettings({ showMeaning })
  },

  getCurrentRecord(grammarId) {
    return this.data.userRecords[Number(grammarId)] || null
  },

  showDetail(e) {
    const grammarId = Number(e.currentTarget.dataset.id)
    const grammar = this.data.grammarList.find((item) => Number(item.grammar_id) === grammarId)
    if (!grammar) return
    const record = this.getCurrentRecord(grammarId)
    const favorite = !!this.data.favoriteMap[grammarId]
    this.setData({
      showModal: true,
      currentGrammar: grammar,
      currentProficiency: record ? record.proficiency || 0 : 0,
      currentRecordId: record ? record._id || '' : '',
      isFavorite: favorite
    })
  },

  hideDetail() {
    this.setData({ showModal: false })
  },

  setProficiency(e) {
    this.setData({ currentProficiency: Number(e.currentTarget.dataset.value) || 0 })
  },

  async updateProficiency() {
    if (!this.data.isLoggedIn || !this.data.currentGrammar) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    const grammarId = Number(this.data.currentGrammar.grammar_id)
    const proficiency = this.data.currentProficiency
    const now = db.serverDate()

    wx.showLoading({ title: '保存中...', mask: true })
    try {
      let recordId = this.data.currentRecordId
      if (recordId) {
        await db
          .collection(RECORDS_COLLECTION)
          .doc(recordId)
          .update({
            data: {
              proficiency,
              last_review: now,
              review_count: _.inc(1),
              updated_at: now,
              collection: this.data.currentCollection
            }
          })
      } else {
        const res = await db.collection(RECORDS_COLLECTION).add({
          data: {
            user_id: this.data.userId,
            grammar_id: grammarId,
            collection: this.data.currentCollection,
            proficiency,
            review_count: 1,
            study_time: now,
            last_review: now,
            created_at: now,
            updated_at: now
          }
        })
        recordId = res._id
      }

      const existed = !!this.data.userRecords[grammarId]
      const userRecords = {
        ...this.data.userRecords,
        [grammarId]: {
          ...(this.data.userRecords[grammarId] || {}),
          _id: recordId,
          user_id: this.data.userId,
          grammar_id: grammarId,
          collection: this.data.currentCollection,
          proficiency,
          review_count: (this.data.userRecords[grammarId]?.review_count || 0) + 1,
          last_review: new Date()
        }
      }

      const learned = existed ? this.data.stats.learned : this.data.stats.learned + 1
      const prevMastered = (this.data.userRecords[grammarId]?.proficiency || 0) >= 4
      const nextMastered = proficiency >= 4
      const mastered =
        this.data.stats.mastered + (prevMastered === nextMastered ? 0 : nextMastered ? 1 : -1)

      this.setData({
        userRecords,
        currentRecordId: recordId,
        showModal: false,
        stats: {
          ...this.data.stats,
          learned,
          mastered,
          percent: this.data.stats.total ? ((learned / this.data.stats.total) * 100).toFixed(1) : '0.0'
        }
      })
      wx.showToast({ title: '保存成功' })
    } catch (error) {
      console.error('updateProficiency failed', error)
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async toggleFavorite() {
    if (!this.data.isLoggedIn || !this.data.currentGrammar) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    const grammarId = Number(this.data.currentGrammar.grammar_id)
    wx.showLoading({ title: '处理中...', mask: true })

    try {
      const res = await db
        .collection(FAVORITES_COLLECTION)
        .where({
          user_id: this.data.userId,
          grammar_id: grammarId
        })
        .get()
      const currentFavorite = this.filterByCollection(res.data).find(
        (item) => Number(item.grammar_id) === grammarId
      )

      const favoriteMap = { ...this.data.favoriteMap }
      let favoritesCount = this.data.stats.favorites
      if (currentFavorite) {
        await db.collection(FAVORITES_COLLECTION).doc(currentFavorite._id).remove()
        delete favoriteMap[grammarId]
        favoritesCount = Math.max(0, favoritesCount - 1)
        this.setData({ isFavorite: false })
        wx.showToast({ title: '已取消收藏', icon: 'success' })
      } else {
        const addRes = await db.collection(FAVORITES_COLLECTION).add({
          data: {
            user_id: this.data.userId,
            grammar_id: grammarId,
            collection: this.data.currentCollection,
            create_time: db.serverDate()
          }
        })
        favoriteMap[grammarId] = {
          _id: addRes._id,
          user_id: this.data.userId,
          grammar_id: grammarId,
          collection: this.data.currentCollection
        }
        favoritesCount += 1
        this.setData({ isFavorite: true })
        wx.showToast({ title: '已收藏', icon: 'success' })
      }

      this.setData({
        favoriteMap,
        stats: {
          ...this.data.stats,
          favorites: favoritesCount
        }
      })
    } catch (error) {
      console.error('toggleFavorite failed', error)
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async showGrammarDetailById(grammarId) {
    let grammar = this.data.grammarList.find((item) => Number(item.grammar_id) === Number(grammarId))
    if (!grammar) {
      try {
        const res = await db
          .collection(this.data.currentCollection)
          .where({ grammar_id: Number(grammarId) })
          .get()
        grammar = res.data[0]
        if (grammar) {
          this.setData({
            grammarList: [grammar].concat(this.data.grammarList)
          })
        }
      } catch (error) {
        console.error('showGrammarDetailById failed', error)
      }
    }
    if (grammar) {
      this.showDetail({ currentTarget: { dataset: { id: grammar.grammar_id } } })
    }
  },

  goToDeepStudy() {
    wx.navigateTo({
      url: `/pages/grammar/deepstudy/deepstudy?collection=${this.data.currentCollection}`
    })
  },

  goToFavorites() {
    wx.navigateTo({
      url: `/pages/grammar/favorites/favorites?collection=${this.data.currentCollection}`
    })
  },

  onShareAppMessage() {
    const currentGrammar = this.data.currentGrammar
    const collectionLabel = this.data.currentCollectionLabel
    const title = currentGrammar
      ? `[${collectionLabel}语法] ${currentGrammar.title}`
      : `我正在学习 ${collectionLabel} 语法`
    const path = currentGrammar
      ? `/pages/grammar/grammar?collection=${this.data.currentCollection}&grammar_id=${currentGrammar.grammar_id}`
      : `/pages/grammar/grammar?collection=${this.data.currentCollection}`
    return {
      title,
      path
    }
  },

  noop() {}
})
