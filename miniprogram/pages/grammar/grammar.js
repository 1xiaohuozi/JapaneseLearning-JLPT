const db = wx.cloud.database()
const _ = db.command

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
    currentRecordId: null
  },

  onLoad() {
    this.loadGrammarList()
    this.loadUserRecords()
  },

  onPullDownRefresh() {
    this.setData({
      grammarList: [],
      currentPage: 1,
      hasMore: true
    }, () => {
      this.loadGrammarList(() => {
        wx.stopPullDownRefresh()
      })
    })
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({
      mode,
      grammarList: [],
      currentPage: 1,
      hasMore: true
    }, this.loadGrammarList)
  },

  onSearchInput(e) {
    this.setData({
      searchText: e.detail.value,
      grammarList: [],
      currentPage: 1,
      hasMore: true
    }, this.loadGrammarList)
  },

  async loadGrammarList(callback) {
    if (this.data.loading) return

    this.setData({ loading: true })

    try {
      let baseQuery = db.collection('grammar_points')

      if (this.data.searchText) {
        const reg = db.RegExp({ regexp: this.data.searchText, options: 'i' })
        baseQuery = baseQuery.where(_.or([
          { grammar_id: reg },
          { title: reg },
          { meaning: reg }
        ]))
      }

      if (this.data.mode === 'random') {
        // 随机抽取 pageSize 个文法点
        const countRes = await baseQuery.count()
        const total = countRes.total

        if (total === 0) {
          this.setData({ grammarList: [], loading: false, hasMore: false })
          return
        }

        const randomIndexes = []
        const max = Math.min(this.data.pageSize, total)
        const indexSet = new Set()

        while (indexSet.size < max) {
          indexSet.add(Math.floor(Math.random() * total))
        }

        const promises = [...indexSet].map(i =>
          baseQuery.skip(i).limit(1).get()
        )

        const resultList = await Promise.all(promises)
        const randomData = resultList.map(r => r.data[0]).filter(Boolean)

        this.setData({
          grammarList: this.data.grammarList.concat(randomData),
          loading: false,
          hasMore: false // 随机模式通常不分页
        })

      } else {
        // 顺序模式
        const res = await baseQuery
          .orderBy('grammar_id', 'asc')
          .skip((this.data.currentPage - 1) * this.data.pageSize)
          .limit(this.data.pageSize)
          .get()

        const newList = this.data.grammarList.concat(res.data)
        this.setData({
          grammarList: newList,
          loading: false,
          hasMore: res.data.length === this.data.pageSize
        })
      }

    } catch (err) {
      console.error('加载文法失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    } finally {
      callback && callback()
    }
  },

  async loadUserRecords() {
    const userId = getApp().globalData.userId
    if (!userId) return

    try {
      const res = await db.collection('user_study_records')
        .where({ user_id: userId })
        .get()

      const records = {}
      res.data.forEach(item => {
        records[item.grammar_id] = item
      })

      this.setData({ userRecords: records })
    } catch (err) {
      console.error('获取用户记录失败:', err)
    }
  },

  loadMore() {
    if (!this.data.hasMore) return

    this.setData({
      currentPage: this.data.currentPage + 1
    }, this.loadGrammarList)
  },

  showDetail(e) {
    const grammarId = e.currentTarget.dataset.id
    const grammar = this.data.grammarList.find(item => item.grammar_id === grammarId)
    const record = this.data.userRecords[grammarId]

    this.setData({
      showModal: true,
      currentGrammar: grammar,
      currentProficiency: record ? record.proficiency : 0,
      currentRecordId: record ? record._id : null
    })
  },

  hideDetail() {
    this.setData({ showModal: false })
  },

  setProficiency(e) {
    this.setData({ currentProficiency: e.currentTarget.dataset.value })
  },

  async updateProficiency() {
    if (!this.data.currentGrammar) return

    const userId = getApp().globalData.userId
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    try {
      if (this.data.currentRecordId) {
        await db.collection('user_study_records').doc(this.data.currentRecordId).update({
          data: {
            proficiency: this.data.currentProficiency,
            last_review: db.serverDate(),
            review_count: _.inc(1),
            updated_at: db.serverDate()
          }
        })
      } else {
        await db.collection('user_study_records').add({
          data: {
            user_id: userId,
            grammar_id: this.data.currentGrammar.grammar_id,
            proficiency: this.data.currentProficiency,
            study_time: db.serverDate(),
            last_review: db.serverDate(),
            review_count: 1,
            created_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        })
      }

      wx.showToast({ title: '保存成功' })
      this.loadUserRecords()
      this.hideDetail()

    } catch (err) {
      console.error('保存失败:', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  }
})
