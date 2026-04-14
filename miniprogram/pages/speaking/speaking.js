const db = wx.cloud.database()

const SECTION_BATCH_SIZE = 20
const RECORD_BATCH_SIZE = 20
const MODAL_STORAGE_KEY = 'shadowingDontShowAgain'

Page({
  data: {
    sectionId: '',
    sectionTitle: '',
    dialogueList: [],
    audioUrl: '',
    isPlaying: false,
    duration: 0,
    durationStr: '0:00',
    currentTime: 0,
    currentTimeStr: '0:00',
    showTranslation: {},
    showDropdown: false,
    sections: [],
    showFirstTimeModal: false,
    dontShowAgain: false,
    userRecords: [],
    listeningProgress: 0,
    listeningProgressStr: '0%',
    currentSectionId: '',
    currentPlayCount: 0,
    currentIsLearned: false
  },

  onLoad() {
    this.innerAudioContext = wx.createInnerAudioContext()

    this.innerAudioContext.onPlay(() => this.setData({ isPlaying: true }))
    this.innerAudioContext.onPause(() => this.setData({ isPlaying: false }))
    this.innerAudioContext.onStop(() => {
      this.setData({ isPlaying: false, currentTime: 0, currentTimeStr: '0:00' })
    })
    this.innerAudioContext.onEnded(async () => {
      this.setData({ isPlaying: false, currentTime: 0, currentTimeStr: '0:00' })
      await this.recordCurrentSectionPlay()
    })
    this.innerAudioContext.onCanplay(() => {
      const trySetDuration = () => {
        const duration = Math.floor(this.innerAudioContext.duration || 0)
        if (duration > 0) {
          this.setData({
            duration,
            durationStr: this.formatTime(duration)
          })
        } else {
          setTimeout(trySetDuration, 200)
        }
      }
      trySetDuration()
    })
    this.innerAudioContext.onTimeUpdate(() => {
      const currentTime = Math.floor(this.innerAudioContext.currentTime || 0)
      this.setData({
        currentTime,
        currentTimeStr: this.formatTime(currentTime)
      })
    })

    this.syncModalPreference()
    this.loadSections()
  },

  onShow() {
    this.syncModalPreference()
  },

  onUnload() {
    if (this.innerAudioContext) {
      this.innerAudioContext.destroy()
    }
  },

  syncModalPreference() {
    const dontShowAgain = !!wx.getStorageSync(MODAL_STORAGE_KEY)
    this.setData({
      dontShowAgain,
      showFirstTimeModal: !dontShowAgain
    })
  },

  closeFirstTimeModal() {
    const dontShowAgain = !!this.data.dontShowAgain
    wx.setStorageSync(MODAL_STORAGE_KEY, dontShowAgain)
    this.setData({ showFirstTimeModal: false })
  },

  toggleDontShowAgain(e) {
    const checked = !!e.detail.value
    this.setData({ dontShowAgain: checked })
    wx.setStorageSync(MODAL_STORAGE_KEY, checked)
  },

  async loadSections() {
    try {
      const countRes = await db.collection('shadowing').count()
      const total = countRes.total || 0
      const tasks = []

      for (let skip = 0; skip < total; skip += SECTION_BATCH_SIZE) {
        tasks.push(
          db.collection('shadowing')
            .orderBy('order', 'asc')
            .skip(skip)
            .limit(SECTION_BATCH_SIZE)
            .get()
        )
      }

      const pages = tasks.length ? await Promise.all(tasks) : []
      const sections = pages.flatMap(page => page.data || [])
      this.setData({ sections })
      await this.loadUserRecords()

      const lastSectionId = wx.getStorageSync('lastSectionId')
      if (lastSectionId && sections.some(section => section._id === lastSectionId)) {
        this.loadSection(lastSectionId)
      } else if (sections.length) {
        this.loadSection(sections[0]._id)
      }
    } catch (error) {
      console.error('加载章节失败:', error)
    }
  },

  loadSection(sectionId) {
    if (!sectionId) return

    db.collection('shadowing').doc(sectionId).get().then(res => {
      const section = res.data
      if (!section) return

      if (this.innerAudioContext) {
        this.innerAudioContext.stop()
      }

      this.innerAudioContext.src = section.audioUrl
      this.setData({
        sectionId: section._id,
        sectionTitle: section.title,
        dialogueList: section.dialogueList || [],
        audioUrl: section.audioUrl,
        showDropdown: false,
        currentTime: 0,
        currentTimeStr: '0:00',
        duration: 0,
        durationStr: '0:00',
        showTranslation: {},
        isPlaying: false,
        currentSectionId: `section-${section._id}`
      })
      wx.setStorageSync('lastSectionId', section._id)
      this.syncCurrentSectionMeta(section._id)
    }).catch(err => console.error('加载小节失败:', err))
  },

  togglePlay() {
    if (!this.innerAudioContext.src) return

    if (this.data.isPlaying) {
      this.innerAudioContext.pause()
    } else {
      this.innerAudioContext.play()
    }
  },

  async loadUserRecords() {
    const userId = wx.getStorageSync('userId') || 'guest'

    try {
      const countRes = await db.collection('user_speaking_records').where({ user_id: userId }).count()
      const total = countRes.total || 0
      const tasks = []

      for (let skip = 0; skip < total; skip += RECORD_BATCH_SIZE) {
        tasks.push(
          db.collection('user_speaking_records')
            .where({ user_id: userId })
            .skip(skip)
            .limit(RECORD_BATCH_SIZE)
            .get()
        )
      }

      const pages = tasks.length ? await Promise.all(tasks) : []
      const userRecords = pages.flatMap(page => page.data || [])
      const recordMap = new Map(userRecords.map(item => [item.section_id, item]))
      const sections = this.data.sections.map(section => {
        const record = recordMap.get(section._id)
        return {
          ...section,
          isLearned: !!record,
          playCount: record ? (record.play_count || 0) : 0
        }
      })
      const learnedCount = sections.filter(section => section.isLearned).length
      const totalCount = sections.length
      const listeningProgress = totalCount ? (learnedCount / totalCount) * 100 : 0

      this.setData({
        userRecords,
        sections,
        listeningProgress,
        listeningProgressStr: `${Math.round(listeningProgress)}%`
      })
      this.syncCurrentSectionMeta(this.data.sectionId, sections)
    } catch (error) {
      console.error('查询学习记录失败:', error)
    }
  },

  syncCurrentSectionMeta(sectionId, sections = this.data.sections) {
    const currentSection = (sections || []).find(item => item._id === sectionId)
    this.setData({
      currentPlayCount: currentSection ? (currentSection.playCount || 0) : 0,
      currentIsLearned: !!(currentSection && currentSection.isLearned)
    })
  },

  async recordCurrentSectionPlay() {
    const userId = wx.getStorageSync('userId') || 'guest'
    const { sectionId } = this.data
    if (!sectionId) return

    try {
      const res = await db.collection('user_speaking_records')
        .where({ user_id: userId, section_id: sectionId })
        .get()

      let nextCount = 1
      if (res.data.length === 0) {
        await db.collection('user_speaking_records').add({
          data: {
            user_id: userId,
            section_id: sectionId,
            play_count: 1,
            create_time: db.serverDate()
          }
        })
      } else {
        const record = res.data[0]
        nextCount = (record.play_count || 0) + 1
        await db.collection('user_speaking_records').doc(record._id).update({
          data: { play_count: nextCount }
        })
      }

      const sections = this.data.sections.map(section => (
        section._id === sectionId
          ? { ...section, isLearned: true, playCount: nextCount }
          : section
      ))
      const learnedCount = sections.filter(section => section.isLearned).length
      const totalCount = sections.length
      const listeningProgress = totalCount ? (learnedCount / totalCount) * 100 : 0

      this.setData({
        sections,
        currentPlayCount: nextCount,
        currentIsLearned: true,
        listeningProgress,
        listeningProgressStr: `${Math.round(listeningProgress)}%`
      })
    } catch (error) {
      console.error('保存学习记录失败:', error)
    }
  },

  onSliderChange(e) {
    const value = Number(e.detail.value) || 0
    if (this.innerAudioContext.src) {
      this.innerAudioContext.seek(value)
      this.setData({
        currentTime: value,
        currentTimeStr: this.formatTime(value)
      })
    }
  },

  toggleTranslation(e) {
    const index = e.currentTarget.dataset.index
    const key = `showTranslation[${index}]`
    this.setData({
      [key]: !this.data.showTranslation[index]
    })
  },

  async toggleSectionDropdown() {
    const showDropdown = !this.data.showDropdown
    this.setData({ showDropdown })
    if (showDropdown) {
      await this.loadUserRecords()
    }
  },

  selectSection(e) {
    const sectionId = e.currentTarget.dataset.id
    if (!sectionId) return
    this.loadSection(sectionId)
  },

  prevSection() {
    const idx = this.data.sections.findIndex(item => item._id === this.data.sectionId)
    if (idx > 0) {
      this.loadSection(this.data.sections[idx - 1]._id)
    } else {
      wx.showToast({ title: '已经是第一节', icon: 'none' })
    }
  },

  nextSection() {
    const idx = this.data.sections.findIndex(item => item._id === this.data.sectionId)
    if (idx < this.data.sections.length - 1) {
      this.loadSection(this.data.sections[idx + 1]._id)
    } else {
      wx.showToast({ title: '已经是最后一节', icon: 'none' })
    }
  },

  formatTime(seconds) {
    if (!seconds) return '0:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s < 10 ? `0${s}` : s}`
  },

  fixOrder() {
    wx.showLoading({ title: '修复中...' })
    wx.cloud.callFunction({
      name: 'getnumber'
    }).then(res => {
      wx.hideLoading()
      wx.showToast({
        title: `更新 ${res.result.updated}/${res.result.total} 条`,
        icon: 'success'
      })
      this.loadSections()
    }).catch(err => {
      wx.hideLoading()
      console.error('修复失败:', err)
      wx.showToast({
        title: '修复失败',
        icon: 'none'
      })
    })
  },

  isSectionLearned(section) {
    if (!section.dialogueList || section.dialogueList.length === 0) return false
    return section.dialogueList.every((_, idx) =>
      this.data.userRecords.includes(`${section._id}-${idx}`)
    )
  }
})
