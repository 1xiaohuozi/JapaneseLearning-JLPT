const db = wx.cloud.database();

Page({
  data: {
    currentTab: 'study',
    words: [],
    favoriteWords: [],
    currentIndex: 0,
    currentWord: {},
    answered: false,
    lastChoice: null,
    isFavorited: false,
    btnDisabled: false,

    // 分页控制
    page: 0,
    pageSize: 20,
    hasMoreWords: true,
    loadingWords: false,
    totalWords: 0, // 总单词数

    favPage: 0,
    hasMoreFavorites: true,
    loadingFavorites: false
  },

  onLoad() {
    this.initWords();
  },

  // 初始化
  async initWords() {
    try {
      const countRes = await db.collection("word").count();
      this.setData({ totalWords: countRes.total });

      // 先取缓存
      const cached = wx.getStorageSync("lastWordProgress");
      let lastWordId = cached?.wordId || null;

      // 如果缓存没有，查数据库最后学习记录
      if (!lastWordId) {
        const userId = wx.getStorageSync("userId") || "guest";
        const lastRes = await db.collection("user_word_records")
          .where({ user_id: userId })
          .orderBy("update_time", "desc")
          .limit(1)
          .get();
        if (lastRes.data.length > 0) {
          lastWordId = lastRes.data[0].word_id;
        }
      }

      // 加载第一页
      await this.loadMoreWords();

      let index = -1;
      if (lastWordId) {
        index = this.data.words.findIndex(w => w._id === lastWordId);
      }

      if (index !== -1) {
        this.setData({
          currentWord: this.data.words[index],
          currentIndex: index
        });
        this.checkFavorite(lastWordId);
      } else if (this.data.words.length > 0) {
        this.setData({
          currentWord: this.data.words[0],
          currentIndex: 0
        });
        this.checkFavorite(this.data.words[0]._id);
      }
    } catch (err) {
      console.error("初始化失败:", err);
    }
  },

  // 分页加载单词
  async loadMoreWords() {
    if (this.data.loadingWords || !this.data.hasMoreWords) return;
    this.setData({ loadingWords: true });

    try {
      const res = await db.collection("word")
        .orderBy("order", "asc")
        .skip(this.data.page * this.data.pageSize)
        .limit(this.data.pageSize)
        .get();

      if (res.data.length < this.data.pageSize) {
        this.setData({ hasMoreWords: false });
      }

      const newWords = await this.markLearnedStatus(res.data);
      const allWords = [...this.data.words, ...newWords];

      this.setData({
        words: allWords,
        page: this.data.page + 1
      });
    } catch (err) {
      console.error("加载单词失败:", err);
    } finally {
      this.setData({ loadingWords: false });
    }
  },

  // 分页加载收藏
  async loadMoreFavorites() {
    if (this.data.loadingFavorites || !this.data.hasMoreFavorites) return;
    this.setData({ loadingFavorites: true });

    const userId = wx.getStorageSync("userId") || "guest";
    try {
      const favRes = await db.collection("user_word_favorites")
        .where({ user_id: userId })
        .skip(this.data.favPage * this.data.pageSize)
        .limit(this.data.pageSize)
        .get();

      if (favRes.data.length < this.data.pageSize) {
        this.setData({ hasMoreFavorites: false });
      }

      const wordIds = favRes.data.map(item => item.word_id);
      if (wordIds.length === 0) {
        this.setData({ loadingFavorites: false });
        return;
      }

      const res = await db.collection("word").where({
        _id: db.command.in(wordIds)
      }).get();

      const favWords = await this.markLearnedStatus(res.data);
      this.setData({
        favoriteWords: [...this.data.favoriteWords, ...favWords],
        favPage: this.data.favPage + 1
      });
    } catch (err) {
      console.error("加载收藏失败:", err);
    } finally {
      this.setData({ loadingFavorites: false });
    }
  },

  // 标记单词熟练度
  async markLearnedStatus(words) {
    const userId = wx.getStorageSync("userId") || "guest";
    try {
      const ids = words.map(w => w._id);
      if (ids.length === 0) return words;

      const res = await db.collection("user_word_records")
        .where({ user_id: userId, word_id: db.command.in(ids) })
        .get();

      const recordMap = {};
      res.data.forEach(r => { recordMap[r.word_id] = r.proficiency || 0; });

      return words.map(w => ({ ...w, proficiency: recordMap[w._id] || 0 }));
    } catch (err) {
      console.error("获取学习记录失败:", err);
      return words.map(w => ({ ...w, proficiency: 0 }));
    }
  },

  // 点击认识
  chooseKnown() {
    if (this.data.btnDisabled) return;
    this.setData({ btnDisabled: true });
    this.updateProficiency(1).then(() => {
      this.setData({ answered: true, lastChoice: 1, btnDisabled: false });
      this.saveProgress();
    });
  },

  // 点击不认识
  chooseUnknown() {
    if (this.data.btnDisabled) return;
    this.setData({ btnDisabled: true });
    this.updateProficiency(-2).then(() => {
      this.setData({ answered: true, lastChoice: 0, btnDisabled: false });
      this.saveProgress();
    });
  },

  // 更新熟练度
  async updateProficiency(delta) {
    const userId = wx.getStorageSync("userId") || "guest";
    const { currentWord, words, currentIndex } = this.data;
    try {
      const res = await db.collection("user_word_records")
        .where({ user_id: userId, word_id: currentWord._id })
        .get();

      let proficiency = currentWord.proficiency || 0;

      if (res.data.length === 0) {
        proficiency = Math.max(0, delta);
        await db.collection("user_word_records").add({
          data: {
            user_id: userId,
            word_id: currentWord._id,
            status: proficiency > 0 ? "mastered" : "learning",
            proficiency,
            review_time: db.serverDate(),
            create_time: db.serverDate(),
            update_time: db.serverDate()
          }
        });
      } else {
        const record = res.data[0];
        proficiency = Math.max(0, (record.proficiency || 0) + delta);
        await db.collection("user_word_records").doc(record._id).update({
          data: {
            status: proficiency > 0 ? "mastered" : "learning",
            proficiency,
            update_time: db.serverDate()
          }
        });
      }

      const updatedWord = { ...currentWord, proficiency };
      const updatedWords = [...words];
      updatedWords[currentIndex] = updatedWord;

      this.setData({ currentWord: updatedWord, words: updatedWords });
    } catch (err) {
      console.error("更新熟练度失败:", err);
    }
  },

  // 下一个单词
  async nextWord() {
    const { currentIndex, words, hasMoreWords } = this.data;
  
    // 找到下一个未学习的单词
    let nextIndex = -1;
    for (let i = currentIndex + 1; i < words.length; i++) {
      if (!words[i].proficiency || words[i].proficiency === 0) {
        nextIndex = i;
        break;
      }
    }
  
    // 如果当前批次没有，就加载下一批
    if (nextIndex === -1 && hasMoreWords) {
      await this.loadMoreWords();
      for (let i = currentIndex + 1; i < this.data.words.length; i++) {
        if (!this.data.words[i].proficiency || this.data.words[i].proficiency === 0) {
          nextIndex = i;
          break;
        }
      }
    }
  
    // 没有下一个了
    if (nextIndex === -1) {
      // wx.showToast({ title: "全部学习完毕！", icon: "success" });
      return;
    }
  
    // 🚩 关键：先重置 answered，等待动画复位
    this.setData({ answered: false, lastChoice: null });
  
    setTimeout(() => {
      this.setData({
        currentIndex: nextIndex,
        currentWord: this.data.words[nextIndex],
      });
      this.checkFavorite(this.data.words[nextIndex]._id);
      this.saveProgress();
    }, 300); // 这里的 300ms 需要和你的翻转动画时长一致
  }
  ,
// ✅ 正确放在 Page({}) 里面的方法
async markLearnedStatus(words) {
  const userId = wx.getStorageSync("userId") || "guest";
  try {
    const ids = words.map(w => w._id);
    if (ids.length === 0) return words;

    const res = await db.collection("user_word_records")
      .where({ user_id: userId, word_id: db.command.in(ids) })
      .get();

    const recordMap = {};
    res.data.forEach(r => { recordMap[r.word_id] = r.proficiency || 0; });

    return words.map(w => ({ ...w, proficiency: recordMap[w._id] || 0 }));
  } catch (err) {
    console.error("获取学习记录失败:", err);
    return words.map(w => ({ ...w, proficiency: 0 }));
  }
},
  // 保存学习进度到缓存
  saveProgress() {
    const { currentWord, currentIndex } = this.data;
    if (currentWord && currentWord._id) {
      wx.setStorageSync("lastWordProgress", {
        wordId: currentWord._id,
        index: currentIndex,
        time: Date.now()
      });
    }
  },

  // 切换Tab
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });

    if (tab === 'favorites' && this.data.favoriteWords.length === 0) {
      this.loadMoreFavorites();
    }
  },

  // 查看单词详情
  viewWordDetail(e) {
    const wordId = e.currentTarget.dataset.id;
    const word = this.data.words.find(w => w._id === wordId)
              || this.data.favoriteWords.find(w => w._id === wordId);
    if (word) {
      this.setData({
        currentTab: 'study',
        currentWord: word,
        currentIndex: this.data.words.findIndex(w => w._id === wordId),
        answered: false,
        lastChoice: null
      });
      this.checkFavorite(word._id);
      this.saveProgress();
    }
  },

  // 收藏操作
  async toggleFavorite() {
    const userId = wx.getStorageSync("userId") || "guest";
    const { currentWord, isFavorited } = this.data;
    if (!currentWord._id) return;

    try {
      const collection = db.collection("user_word_favorites");
      if (isFavorited) {
        const res = await collection.where({ user_id: userId, word_id: currentWord._id }).get();
        if (res.data.length) await collection.doc(res.data[0]._id).remove();
        this.setData({ isFavorited: false });
      } else {
        await collection.add({
          data: {
            user_id: userId,
            word_id: currentWord._id,
            create_time: db.serverDate()
          }
        });
        this.setData({ isFavorited: true });
      }
    } catch (err) {
      console.error("收藏操作失败:", err);
    }
  },

  // 检查收藏状态
  async checkFavorite(wordId) {
    const userId = wx.getStorageSync("userId") || "guest";
    try {
      const res = await db.collection("user_word_favorites")
        .where({ user_id: userId, word_id: wordId })
        .get();
      this.setData({
        isFavorited: res.data.length > 0
      });
    } catch (err) {
      console.error("检查收藏失败:", err);
      this.setData({ isFavorited: false });
    }
  }
});
