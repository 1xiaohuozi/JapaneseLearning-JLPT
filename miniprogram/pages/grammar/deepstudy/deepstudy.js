const db = wx.cloud.database()
const _ = db.command
const { markTaskCompleted, getNextTaskSuggestion } = require('../../../utils/retention')
const { getStudyPlan } = require('../../../utils/studyPlan')
const BATCH_SIZE = 20

const COLLECTIONS = [
  { key: 'n1_grammar', label: 'N1', theme: 'summit' },
  { key: 'n2_grammar', label: 'N2', theme: 'ocean' },
  { key: 'n3_grammar', label: 'N3', theme: 'forest' },
  { key: 'n4n5_grammar', label: 'N4/N5', theme: 'sunrise' }
]

function getCollectionConfig(collectionKey) {
  return COLLECTIONS.find((item) => item.key === collectionKey) || COLLECTIONS[1]
}

Page({
  data: {
    collections: COLLECTIONS,
    currentCollection: 'n2_grammar',
    currentCollectionLabel: 'N2',
    currentTheme: 'ocean',
    currentGrammar: null,
    currentProficiency: 0,
    isFavorite: false,
    loading: true,
    showDetail: false,
    allCompleted: false,
    reviewRemaining: 0,
    newRemaining: 0,
    sessionTarget: 10,
    sessionTotal: 0,
    completedCount: 0
  },

  userId: '',
  grammarList: [],
  studyRecords: {},
  favoriteMap: {},
  currentIndex: 0,

  onLoad(options = {}) {
    this._pendingOptions = options || {}
    this.initGrammarPage(options)
  },

  onShow() {
    const userId = wx.getStorageSync('userId') || ''
    if (!userId) return
    if (this.userId !== userId || (!this.data.currentGrammar && !this.data.allCompleted && !this.data.loading)) {
      this.initGrammarPage(this._pendingOptions || {})
    }
  },

  initGrammarPage(options = {}) {
    const userId = wx.getStorageSync('userId') || ''
    if (!userId) {
      this.setData({ loading: false })
      wx.showModal({
        title: '提示',
        content: '语法学习需要先登录，登录后才能保存学习记录。现在去登录吗？',
        confirmText: '去登录',
        cancelText: '回学习台',
        success: (res) => {
          if (res.confirm) {
            wx.setStorageSync('login_redirect_url', '/pages/grammar/deepstudy/deepstudy')
            wx.navigateTo({ url: '/pages/profile/login/login' })
          } else {
            wx.switchTab({ url: '/pages/profile/profile' })
          }
        }
      })
      return
    }

    const settings = wx.getStorageSync('grammar_learning_settings') || {}
    const collection = options.collection || settings.collectionKey || 'n2_grammar'
    const config = getCollectionConfig(collection)
    this.userId = userId
    this.setData({
      currentCollection: config.key,
      currentCollectionLabel: config.label,
      currentTheme: config.theme
    })
    this.loadGrammar()
  },

  filterByCollection(records, collectionKey = this.data.currentCollection) {
    return (records || []).filter((item) => {
      if (item.collection) return item.collection === collectionKey
      return collectionKey === 'n2_grammar'
    })
  },

  async getAllGrammarPoints() {
    const countRes = await db.collection(this.data.currentCollection).count()
    const total = countRes.total || 0
    if (!total) return []
    const tasks = []
    const batchTimes = Math.ceil(total / BATCH_SIZE)
    for (let i = 0; i < batchTimes; i += 1) {
      tasks.push(
        db
          .collection(this.data.currentCollection)
          .orderBy('grammar_id', 'asc')
          .skip(i * BATCH_SIZE)
          .limit(BATCH_SIZE)
          .get()
      )
    }
    const results = await Promise.all(tasks)
    return results.flatMap((res) => res.data)
  },

  async getUserRecords() {
    const countRes = await db.collection('user_study_records').where({ user_id: this.userId }).count()
    const total = countRes.total || 0
    if (!total) return []
    const tasks = []
    const batchTimes = Math.ceil(total / BATCH_SIZE)
    for (let i = 0; i < batchTimes; i += 1) {
      tasks.push(
        db
          .collection('user_study_records')
          .where({ user_id: this.userId })
          .skip(i * BATCH_SIZE)
          .limit(BATCH_SIZE)
          .get()
      )
    }
    const results = await Promise.all(tasks)
    return this.filterByCollection(results.flatMap((res) => res.data))
  },

  async getFavorites() {
    const countRes = await db.collection('user_favorites').where({ user_id: this.userId }).count()
    const total = countRes.total || 0
    if (!total) return []
    const tasks = []
    const batchTimes = Math.ceil(total / BATCH_SIZE)
    for (let i = 0; i < batchTimes; i += 1) {
      tasks.push(
        db
          .collection('user_favorites')
          .where({ user_id: this.userId })
          .skip(i * BATCH_SIZE)
          .limit(BATCH_SIZE)
          .get()
      )
    }
    const results = await Promise.all(tasks)
    return this.filterByCollection(results.flatMap((res) => res.data))
  },

  buildStudyQueue(allGrammar, records) {
    const sessionLimit = this.data.sessionTarget || 10
    const now = Date.now()
    const reviewQueue = []
    const newQueue = []

    allGrammar.forEach((grammar) => {
      const record = records[Number(grammar.grammar_id)]
      if (!record) {
        newQueue.push(grammar)
        return
      }
      const last = record.last_review ? new Date(record.last_review).getTime() : 0
      const days = last ? Math.floor((now - last) / (1000 * 60 * 60 * 24)) : 99
      const proficiency = Number(record.proficiency) || 0
      const shouldReview = days >= Math.max(1, 5 - proficiency)
      if (shouldReview || proficiency < 4) reviewQueue.push(grammar)
    })

    reviewQueue.sort((a, b) => {
      const aRecord = records[Number(a.grammar_id)]
      const bRecord = records[Number(b.grammar_id)]
      const aTime = new Date(aRecord?.last_review || 0).getTime()
      const bTime = new Date(bRecord?.last_review || 0).getTime()
      return aTime - bTime
    })

    const session = []
    let reviewIndex = 0
    let newIndex = 0

    while (session.length < sessionLimit && (reviewIndex < reviewQueue.length || newIndex < newQueue.length)) {
      if (reviewIndex < reviewQueue.length) {
        session.push({ ...reviewQueue[reviewIndex], sessionType: 'review' })
        reviewIndex += 1
      }
      if (session.length >= sessionLimit) break
      if (reviewIndex < reviewQueue.length) {
        session.push({ ...reviewQueue[reviewIndex], sessionType: 'review' })
        reviewIndex += 1
      }
      if (session.length >= sessionLimit) break
      if (newIndex < newQueue.length) {
        session.push({ ...newQueue[newIndex], sessionType: 'new' })
        newIndex += 1
      }
    }

    return {
      merged: session,
      reviewQueue,
      newQueue,
      sessionReviewCount: session.filter(item => item.sessionType === 'review').length,
      sessionNewCount: session.filter(item => item.sessionType === 'new').length
    }
  },

  async loadGrammar() {
    this._grammarRecapShown = false
    this._weakGrammarMap = {}
    const plan = getStudyPlan()
    this.setData({
      loading: true,
      allCompleted: false,
      showDetail: false,
      currentGrammar: null,
      sessionTarget: plan.daily.grammarLimit || 10
    })
    wx.showLoading({ title: '加载语法中' })
    try {
      const [allGrammar, records, favorites] = await Promise.all([
        this.getAllGrammarPoints(),
        this.getUserRecords(),
        this.getFavorites()
      ])
      this.studyRecords = {}
      records.forEach((item) => {
        this.studyRecords[Number(item.grammar_id)] = item
      })
      this.favoriteMap = {}
      favorites.forEach((item) => {
        this.favoriteMap[Number(item.grammar_id)] = item
      })

      const { merged, sessionReviewCount, sessionNewCount } = this.buildStudyQueue(allGrammar, this.studyRecords)
      this.grammarList = merged
      this.currentIndex = 0

      if (!merged.length) {
        this.setData({
          loading: false,
          allCompleted: true,
          reviewRemaining: 0,
          newRemaining: 0,
          sessionTotal: 0,
          completedCount: 0
        })
        return
      }

      const first = merged[0]
      const firstRecord = this.studyRecords[Number(first.grammar_id)] || {}
      this.setData({
        loading: false,
        currentGrammar: first,
        currentProficiency: firstRecord.proficiency || 0,
        isFavorite: !!this.favoriteMap[Number(first.grammar_id)],
        reviewRemaining: sessionReviewCount,
        newRemaining: sessionNewCount,
        sessionTotal: merged.length,
        completedCount: 0
      })
    } catch (error) {
      console.error('loadGrammar failed', error)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  switchCollection(e) {
    const config = getCollectionConfig(e.currentTarget.dataset.collection)
    if (config.key === this.data.currentCollection) return
    this.setData({
      currentCollection: config.key,
      currentCollectionLabel: config.label,
      currentTheme: config.theme
    })
    const settings = wx.getStorageSync('grammar_learning_settings') || {}
    wx.setStorageSync('grammar_learning_settings', {
      ...settings,
      collectionKey: config.key
    })
    this.loadGrammar()
  },

  async handleAnswer(e) {
    if (!this.data.currentGrammar) return
    const known = e.currentTarget.dataset.known === 'true'
    const grammarId = Number(this.data.currentGrammar.grammar_id)

    wx.showLoading({ title: '更新进度中' })
    try {
      const record = this.studyRecords[grammarId]
      let proficiency = 0
      let recordId = record?._id
      if (recordId) {
        proficiency = known ? Math.min(5, (record.proficiency || 0) + 1) : Math.max(0, (record.proficiency || 0) - 1)
        await db.collection('user_study_records').doc(recordId).update({
          data: {
            proficiency,
            review_count: _.inc(1),
            last_review: db.serverDate(),
            collection: this.data.currentCollection
          }
        })
      } else {
        proficiency = known ? 1 : 0
        const res = await db.collection('user_study_records').add({
          data: {
            user_id: this.userId,
            grammar_id: grammarId,
            collection: this.data.currentCollection,
            proficiency,
            review_count: 1,
            study_time: db.serverDate(),
            last_review: db.serverDate()
          }
        })
        recordId = res._id
      }

      this.studyRecords[grammarId] = {
        ...(this.studyRecords[grammarId] || {}),
        _id: recordId,
        grammar_id: grammarId,
        collection: this.data.currentCollection,
        proficiency
      }
      if (!known || proficiency < 4) {
        this._weakGrammarMap = {
          ...(this._weakGrammarMap || {}),
          [grammarId]: {
            ...this.data.currentGrammar,
            sessionType: 'review'
          }
        }
      }
      this.setData({
        currentProficiency: proficiency,
        showDetail: true
      })
    } catch (error) {
      console.error('handleAnswer failed', error)
      wx.showToast({ title: '更新失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async nextGrammar() {
    this.currentIndex += 1
    if (this.currentIndex >= this.grammarList.length) {
      this.setData({
        currentGrammar: null,
        allCompleted: true,
        showDetail: false,
        reviewRemaining: 0,
        newRemaining: 0,
        completedCount: this.grammarList.length
      })
      this.showStudyRecap()
      return
    }
    const currentGrammar = this.grammarList[this.currentIndex]
    const record = this.studyRecords[Number(currentGrammar.grammar_id)] || {}
    const remaining = this.grammarList.slice(this.currentIndex)
    let reviewRemaining = 0
    let newRemaining = 0
    remaining.forEach((item) => {
      if (item.sessionType === 'review') reviewRemaining += 1
      else newRemaining += 1
    })

    this.setData({
      currentGrammar,
      currentProficiency: record.proficiency || 0,
      isFavorite: !!this.favoriteMap[Number(currentGrammar.grammar_id)],
      showDetail: false,
      reviewRemaining,
      newRemaining,
      completedCount: this.currentIndex
    })
  },

  showStudyRecap() {
    if (this._grammarRecapShown || !this.grammarList.length) return
    this._grammarRecapShown = true

    const completed = this.grammarList.length
    markTaskCompleted('grammar', {
      text: `完成 ${completed} / ${this.data.sessionTarget} 条语法`,
      completed,
      collection: this.data.currentCollectionLabel
    })

    wx.showModal({
      title: '语法巩固完成',
      content: `本轮目标 ${this.data.sessionTarget} 条，你完成了 ${completed} 条 ${this.data.currentCollectionLabel} 语法。接下来可以回学习台、再来一轮，或者立刻补低熟练语法。`,
      confirmText: '选择下一步',
      showCancel: false,
      success: () => this.showGrammarNextActions()
    })
  },

  showGrammarNextActions() {
    const weakCount = Object.keys(this._weakGrammarMap || {}).length
    const nextTask = getNextTaskSuggestion('grammar')
    wx.showActionSheet({
      itemList: [
        nextTask.label,
        '状态不错，再来一轮',
        weakCount ? `复习低熟练语法 ${weakCount} 条` : '查看语法收藏'
      ],
      success: res => {
        if (res.tapIndex === 0) {
          this.goToSuggestedTask(nextTask)
          return
        }
        if (res.tapIndex === 1) {
          this.loadGrammar()
          return
        }
        if (weakCount) {
          this.startWeakGrammarReview()
        } else {
          this.goToFavorites()
        }
      }
    })
  },

  goToSuggestedTask(nextTask) {
    if (!nextTask || !nextTask.hasNext || !nextTask.task) {
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    if (nextTask.task.key === 'grammar') {
      this.loadGrammar()
      return
    }
    wx.switchTab({ url: nextTask.task.route })
  },

  startWeakGrammarReview() {
    const weakList = Object.values(this._weakGrammarMap || {})
    if (!weakList.length) return
    const first = weakList[0]
    const firstRecord = this.studyRecords[Number(first.grammar_id)] || {}

    this.grammarList = weakList
    this.currentIndex = 0
    this._grammarRecapShown = false
    this._weakGrammarMap = {}
    this.setData({
      currentGrammar: first,
      currentProficiency: firstRecord.proficiency || 0,
      isFavorite: !!this.favoriteMap[Number(first.grammar_id)],
      showDetail: false,
      allCompleted: false,
      reviewRemaining: weakList.length,
      newRemaining: 0,
      sessionTotal: weakList.length,
      completedCount: 0
    })
  },

  async toggleFavorite() {
    if (!this.data.currentGrammar) return
    const grammarId = Number(this.data.currentGrammar.grammar_id)
    wx.showLoading({ title: '处理中...' })
    try {
      const res = await db
        .collection('user_favorites')
        .where({ user_id: this.userId, grammar_id: grammarId })
        .get()
      const target = this.filterByCollection(res.data).find((item) => Number(item.grammar_id) === grammarId)
      if (target?._id) {
        await db.collection('user_favorites').doc(target._id).remove()
        delete this.favoriteMap[grammarId]
        this.setData({ isFavorite: false })
        wx.showToast({ title: '已取消收藏', icon: 'success' })
      } else {
        const addRes = await db.collection('user_favorites').add({
          data: {
            user_id: this.userId,
            grammar_id: grammarId,
            collection: this.data.currentCollection,
            create_time: db.serverDate()
          }
        })
        this.favoriteMap[grammarId] = { _id: addRes._id, grammar_id: grammarId }
        this.setData({ isFavorite: true })
        wx.showToast({ title: '已收藏', icon: 'success' })
      }
    } catch (error) {
      console.error('toggleFavorite failed', error)
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async resetStudy() {
    wx.showLoading({ title: '重置中...' })
    try {
      const res = await db.collection('user_study_records').where({ user_id: this.userId }).get()
      const targets = this.filterByCollection(res.data)
      for (const item of targets) {
        if (item._id) {
          await db.collection('user_study_records').doc(item._id).remove()
        }
      }
      this.studyRecords = {}
      await this.loadGrammar()
      wx.showToast({ title: '已重置', icon: 'success' })
    } catch (error) {
      console.error('resetStudy failed', error)
      wx.showToast({ title: '重置失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  goToOverview() {
    wx.navigateTo({
      url: `/pages/grammar/grammar?collection=${this.data.currentCollection}`
    })
  },

  goToFavorites() {
    wx.navigateTo({
      url: `/pages/grammar/favorites/favorites?collection=${this.data.currentCollection}`
    })
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: `我正在学习 ${this.data.currentCollectionLabel} 语法`,
      path: `/pages/grammar/deepstudy/deepstudy?collection=${this.data.currentCollection}`
    }
  }
})
