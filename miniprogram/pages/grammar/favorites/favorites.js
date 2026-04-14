const db = wx.cloud.database()
const BATCH_SIZE = 20

const COLLECTIONS = [
  { key: 'n1_grammar', label: 'N1' },
  { key: 'n2_grammar', label: 'N2' },
  { key: 'n3_grammar', label: 'N3' },
  { key: 'n4n5_grammar', label: 'N4/N5' }
]

function getCollectionConfig(collectionKey) {
  return COLLECTIONS.find((item) => item.key === collectionKey) || COLLECTIONS[1]
}

Page({
  data: {
    collections: COLLECTIONS,
    currentCollection: 'n2_grammar',
    currentCollectionLabel: 'N2',
    userId: '',
    searchText: '',
    showMeaning: true,
    allList: [],
    favoritesList: [],
    loading: false,
    showModal: false,
    currentGrammar: {}
  },

  onLoad(options) {
    const userId = wx.getStorageSync('userId') || ''
    if (!userId) {
      wx.showModal({
        title: '提示',
        content: '语法收藏需要先登录，是否现在前往登录？',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/profile/login/login' })
          } else {
            wx.navigateBack()
          }
        }
      })
      return
    }

    const collectionKey = getCollectionConfig(options.collection).key
    const settings = wx.getStorageSync('grammar_learning_settings') || {}
    const showMeaning = typeof settings.showMeaning === 'boolean' ? settings.showMeaning : true
    const collection = options.collection || settings.collectionKey || collectionKey

    this.setData(
      {
        userId,
        currentCollection: getCollectionConfig(collection).key,
        currentCollectionLabel: getCollectionConfig(collection).label,
        showMeaning
      },
      () => this.loadFavorites()
    )
  },

  async loadFavorites() {
    this.setData({ loading: true })
    wx.showLoading({ title: '加载收藏中' })
    try {
      const countRes = await db.collection('user_favorites').where({ user_id: this.data.userId }).count()
      const total = countRes.total || 0
      if (!total) {
        this.setData({ allList: [], favoritesList: [], loading: false })
        return
      }

      const tasks = []
      const batchTimes = Math.ceil(total / BATCH_SIZE)
      for (let i = 0; i < batchTimes; i += 1) {
        tasks.push(
          db
            .collection('user_favorites')
            .where({ user_id: this.data.userId })
            .skip(i * BATCH_SIZE)
            .limit(BATCH_SIZE)
            .get()
        )
      }
      const favResults = await Promise.all(tasks)
      const favorites = favResults
        .flatMap((res) => res.data)
        .filter((item) => (item.collection ? item.collection === this.data.currentCollection : this.data.currentCollection === 'n2_grammar'))
        .sort((a, b) => new Date(b.create_time || 0) - new Date(a.create_time || 0))

      const grammarIds = favorites.map((item) => Number(item.grammar_id))
      if (!grammarIds.length) {
        this.setData({ allList: [], favoritesList: [], loading: false })
        return
      }

      const grammarTasks = []
      for (let i = 0; i < grammarIds.length; i += BATCH_SIZE) {
        const ids = grammarIds.slice(i, i + BATCH_SIZE)
        grammarTasks.push(
          db.collection(this.data.currentCollection).where({ grammar_id: db.command.in(ids) }).get()
        )
      }
      const grammarResults = await Promise.all(grammarTasks)
      const grammarMap = {}
      grammarResults.flatMap((res) => res.data).forEach((item) => {
        grammarMap[Number(item.grammar_id)] = item
      })

      const allList = favorites
        .map((favorite) => grammarMap[Number(favorite.grammar_id)])
        .filter(Boolean)

      this.setData({
        allList,
        favoritesList: allList,
        loading: false
      })
    } catch (error) {
      console.error('loadFavorites failed', error)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  switchCollection(e) {
    const config = getCollectionConfig(e.currentTarget.dataset.collection)
    if (config.key === this.data.currentCollection) return
    this.setData(
      {
        currentCollection: config.key,
        currentCollectionLabel: config.label,
        searchText: '',
        allList: [],
        favoritesList: []
      },
      () => this.loadFavorites()
    )
  },

  onSearchInput(e) {
    const searchText = (e.detail.value || '').trim()
    const favoritesList = searchText
      ? this.data.allList.filter(
          (item) =>
            item.title?.includes(searchText) ||
            item.meaning?.includes(searchText) ||
            String(item.grammar_id).includes(searchText)
        )
      : this.data.allList
    this.setData({ searchText, favoritesList })
  },

  clearSearch() {
    this.setData({ searchText: '', favoritesList: this.data.allList })
  },

  toggleMeaning(e) {
    this.setData({ showMeaning: !!e.detail.value })
  },

  showDetail(e) {
    const grammarId = Number(e.currentTarget.dataset.id)
    const currentGrammar = this.data.allList.find((item) => Number(item.grammar_id) === grammarId)
    if (!currentGrammar) return
    this.setData({ currentGrammar, showModal: true })
  },

  hideDetail() {
    this.setData({ showModal: false })
  },

  async removeFavorite() {
    const currentGrammar = this.data.currentGrammar
    if (!currentGrammar.grammar_id) return
    wx.showLoading({ title: '处理中...' })
    try {
      const res = await db
        .collection('user_favorites')
        .where({
          user_id: this.data.userId,
          grammar_id: Number(currentGrammar.grammar_id)
        })
        .get()
      const target = res.data.find((item) =>
        item.collection ? item.collection === this.data.currentCollection : this.data.currentCollection === 'n2_grammar'
      )
      if (target?._id) {
        await db.collection('user_favorites').doc(target._id).remove()
      }
      const allList = this.data.allList.filter((item) => Number(item.grammar_id) !== Number(currentGrammar.grammar_id))
      const favoritesList = this.data.favoritesList.filter(
        (item) => Number(item.grammar_id) !== Number(currentGrammar.grammar_id)
      )
      this.setData({ allList, favoritesList, showModal: false })
      wx.showToast({ title: '已取消收藏', icon: 'success' })
    } catch (error) {
      console.error('removeFavorite failed', error)
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  noop() {}
  
})
