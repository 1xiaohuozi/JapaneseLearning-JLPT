const db = wx.cloud.database();

Page({
  data: {
    sectionId: "",           // 当前小节ID
    sectionTitle: "",        // 当前小节标题
    dialogueList: [],        // 对话列表
    audioUrl: "",            // 音频URL
    isPlaying: false,        // 是否正在播放
    duration: 0,             // 音频总时长
    currentTime: 0,          // 当前播放时间
    showTranslation: {},     // 翻译显示状态
    showDropdown: false,     // 下拉菜单显示
    sections: []   ,          // 所有小节列表
    showFirstTimeModal: false, // 是否显示首次弹窗
    dontShowAgain: false ,       // 是否选择不再提示
    userRecords: [],  // 已学习的对话记录

  },

  onLoad() {
    this.innerAudioContext = wx.createInnerAudioContext();

    // 播放状态变化
    this.innerAudioContext.onPlay(() => this.setData({ isPlaying: true }));
    this.innerAudioContext.onPause(() => this.setData({ isPlaying: false }));
    this.innerAudioContext.onStop(() => this.setData({ isPlaying: false, currentTime: 0 }));
    this.innerAudioContext.onEnded(() => {
      this.setData({ isPlaying: false, currentTime: 0 });
    
      // 播放完成，才记录学习
      const userId = wx.getStorageSync('userId') || 'guest';
      const { sectionId } = this.data;
      const dbCollection = wx.cloud.database().collection('user_speaking_records');
    
      dbCollection.where({ user_id: userId, section_id: sectionId })
        .get()
        .then(res => {
          if (res.data.length === 0) {
            // 新增记录
            dbCollection.add({
              data: {
                user_id: userId,
                section_id: sectionId,
                play_count: 1,
                create_time: wx.cloud.database().serverDate()
              }
            }).then(() => this.loadUserRecords())
              .catch(err => console.error("新增学习记录失败:", err));
          } else {
            // 累加 play_count
            const recordId = res.data[0]._id;
            const newCount = (res.data[0].play_count || 0) + 1;
            dbCollection.doc(recordId).update({
              data: { play_count: newCount }
            }).then(() => this.loadUserRecords())
              .catch(err => console.error("更新学习次数失败:", err));
          }
        })
        .catch(err => console.error("查询学习记录失败:", err));
    });
    

    // 音频准备好时获取总时长
    this.innerAudioContext.onCanplay(() => {
      const trySetDuration = () => {
        const dur = this.innerAudioContext.duration;
        if (dur && dur > 0) {
          this.setData({
            duration: Math.floor(dur),
            durationStr: this.formatTime(Math.floor(dur))
          });
          // console.log('durationStr =', this.data.durationStr);
        } else {
          setTimeout(trySetDuration, 200);
        }
      };
      trySetDuration();
    });
    

    // 更新播放进度
    this.innerAudioContext.onTimeUpdate(() => {
      const currentTime = Math.floor(this.innerAudioContext.currentTime);
      this.setData({
        currentTime,
        currentTimeStr: this.formatTime(currentTime)
      });
    });
    
    // console.log(this.data.currentTime);
    // console.log(this.data.duration);
      // 检查是否第一次进入
  // 检查是否显示弹窗 - 修改后的逻辑
  const dontShowAgain = wx.getStorageSync('shadowingDontShowAgain');
  this.setData({ 
    showFirstTimeModal: !dontShowAgain,
    dontShowAgain: dontShowAgain || false
  });
    // 加载章节列表
    this.loadSections().then(() => {
      this.loadUserRecords(); // 页面初次进入刷新进度
    });
    

  },

// 关闭弹窗
closeFirstTimeModal() {
  this.setData({ showFirstTimeModal: false });
  if (this.data.dontShowAgain) {
    wx.setStorageSync('shadowingDontShowAgain', true);
  }
},

// 切换“不再提示”
toggleDontShowAgain(e) {
  const checked = e.detail.value.length > 0;
  this.setData({ dontShowAgain: checked });
  wx.setStorageSync('shadowingDontShowAgain', checked);
},


  // 加载所有章节
// 加载所有章节
// 加载所有章节（突破20条限制）
async loadSections() {
  const db = wx.cloud.database();
  const MAX_LIMIT = 20;
  
  // 先获取总数
  const countRes = await db.collection("shadowing").count();
  const total = countRes.total;

  const batchTimes = Math.ceil(total / MAX_LIMIT);
  const tasks = [];

  for (let i = 0; i < batchTimes; i++) {
    const promise = db.collection("shadowing")
      .orderBy("order", "asc")
      .skip(i * MAX_LIMIT)
      .limit(MAX_LIMIT)
      .get();
    tasks.push(promise);
  }

  // 等待所有请求完成
  Promise.all(tasks).then(resList => {
    const allData = resList.reduce((acc, cur) => acc.concat(cur.data), []);
    this.setData({ sections: allData });

    // 取本地存储的最后一次小节ID
    const lastSectionId = wx.getStorageSync('lastSectionId');
    if (lastSectionId && allData.some(s => s._id === lastSectionId)) {
      this.loadSection(lastSectionId); // 加载上次听的小节
    } else if (allData.length > 0) {
      this.loadSection(allData[0]._id); // 默认第一节
      
    }
  }).catch(err => console.error("加载章节失败:", err));
}
,


  // 加载某一节内容
  loadSection(sectionId) {
    if (!sectionId) return;

    db.collection("shadowing").doc(sectionId).get().then(res => {
      const section = res.data;
      if (!section) return;

      // 停止当前播放
      if (this.innerAudioContext) this.innerAudioContext.stop();

      // 设置音频
      this.innerAudioContext.src = section.audioUrl;

      // 重置状态
      this.setData({
        sectionId: section._id,
        sectionTitle: section.title,
        dialogueList: section.dialogueList || [],
        audioUrl: section.audioUrl,
        showDropdown: false,
        currentTime: 0,
        duration: 0,
        showTranslation: {},
        isPlaying: false,
        currentSectionId: "section-" + section._id   // ✅ 用于 scroll-into-view
      });
       // ✅ 存储当前小节ID
      wx.setStorageSync('lastSectionId', section._id);

    }).catch(err => console.error("加载小节失败:", err));
  },

  // 播放 / 暂停切换
  togglePlay(e) {
    if (!this.innerAudioContext.src) return;
  
    if (this.data.isPlaying) {
      this.innerAudioContext.pause();
    } else {
      this.innerAudioContext.play();
    }
  },  
  
  
  // 获取当前用户所有已学记录
  loadUserRecords() {
    const userId = wx.getStorageSync('userId') || 'guest';
    const db = wx.cloud.database();
  
    db.collection('user_speaking_records')
      .where({ user_id: userId })
      .get()
      .then(res => {
        const userRecords = res.data; // [{section_id, play_count}, ...]
  
        // 更新 sections 的 isLearned / playCount
        const sections = this.data.sections.map(sec => {
          const record = userRecords.find(r => r.section_id === sec._id);
          return {
            ...sec,
            isLearned: !!record,
            playCount: record ? record.play_count : 0
          };
        });
  
        // 计算已学比例
        const learnedCount = sections.filter(s => s.isLearned).length;
        const totalCount = sections.length;
        const listeningProgress = totalCount > 0 ? (learnedCount / totalCount * 100) : 0;
        //拼接百分号（微信不支持直接显示，只能返回字符串）
        this.setData({ listeningProgressStr: listeningProgress + '%' });


  
        this.setData({ sections, listeningProgress });
      })
      .catch(err => console.error("查询学习记录失败:", err));
  },
  
  // 进度条拖动
  onSliderChange(e) {
    const value = e.detail.value;
    if (this.innerAudioContext.src) {
      this.innerAudioContext.seek(value);
      this.setData({ currentTime: value });
    }
  },

  // 翻译按钮
  toggleTranslation(e) {
    const index = e.currentTarget.dataset.index;
    const key = `showTranslation[${index}]`;
    this.setData({
      [key]: !this.data.showTranslation[index]
    });
  },

  // 下拉菜单显示/隐藏
  toggleSectionDropdown() {
    const newShow = !this.data.showDropdown;
    this.setData({ showDropdown: newShow });
  
    if (newShow) {
      // 展开下拉框时，立刻更新已学状态
      this.loadUserRecords();
    }
  },
  

  // 选择某一节
  selectSection(e) {
    const sectionId = e.currentTarget.dataset.id;
    if (!sectionId) return;
    this.loadSection(sectionId);
  },

  // 上一节
  prevSection() {
    const idx = this.data.sections.findIndex(s => s._id === this.data.sectionId);
    if (idx > 0) this.loadSection(this.data.sections[idx - 1]._id);
    else wx.showToast({ title: '已经是第一节', icon: 'none' });
  },

  // 下一节
  nextSection() {
    const idx = this.data.sections.findIndex(s => s._id === this.data.sectionId);
    if (idx < this.data.sections.length - 1) this.loadSection(this.data.sections[idx + 1]._id);
    else wx.showToast({ title: '已经是最后一节', icon: 'none' });
  },

  // 时间格式化 mm:ss
  formatTime(seconds) {
    if (!seconds) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" + s : s}`;
  },

  // onUnload() {
  //   if (this.innerAudioContext) this.innerAudioContext.destroy();
  // },

  
  // 修复排序按钮
fixOrder() {
  wx.showLoading({ title: "修复中..." });
  wx.cloud.callFunction({
    name: 'getnumber'
  }).then(res => {
    wx.hideLoading();
    console.log("修复完成:", res);
    wx.showToast({
      title: `更新 ${res.result.updated}/${res.result.total} 条`,
      icon: 'success'
    });
    // 重新加载章节
    this.loadSections();
  }).catch(err => {
    wx.hideLoading();
    console.error("修复失败:", err);
    wx.showToast({
      title: '修复失败',
      icon: 'none'
    });
  });
},
// 判断整节是否已学
isSectionLearned(section) {
  if (!section.dialogueList || section.dialogueList.length === 0) return false;
  // 每个对话ID: section._id + '-' + index
  return section.dialogueList.every((_, idx) => 
    this.data.userRecords.includes(section._id + '-' + idx)
  );
},


});