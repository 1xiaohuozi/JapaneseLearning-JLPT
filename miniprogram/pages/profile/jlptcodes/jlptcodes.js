// 获取数据库引用
const db = wx.cloud.database();
const scoreCollection = db.collection('user_jlptscores');

Page({
  data: {
    showPopup: false,
    showHistoryPopup: false,
    showSaveBtn: false,
    sections: [
      {
        title: "文字・語彙",
        questions: [
          { index: 1, placeholder: "5", mdscore: 5, total: 5, correct: 0 },
          { index: 2, placeholder: "5", mdscore: 5, total: 5, correct: 0 },
          { index: 3, placeholder: "3", mdscore: 5, total: 3, correct: 0 },
          { index: 4, placeholder: "7", mdscore: 7, total: 7, correct: 0 },
          { index: 5, placeholder: "5", mdscore: 5, total: 5, correct: 0 },
          { index: 6, placeholder: "5", mdscore: 10, total: 5, correct: 0 }
        ]
      },
      {
        title: "文法",
        questions: [
          { index: 7, placeholder: "12", mdscore: 12, total: 12, correct: 0 },
          { index: 8, placeholder: "5", mdscore: 6, total: 5, correct: 0 },
          { index: 9, placeholder: "4", mdscore: 5, total: 4, correct: 0 }
        ]
      },
      {
        title: "読解",
        questions: [
          { index: 10, placeholder: "5", mdscore: 10, total: 5, correct: 0 },
          { index: 11, placeholder: "8", mdscore: 27, total: 8, correct: 0 },
          { index: 12, placeholder: "2", mdscore: 6, total: 2, correct: 0 },
          { index: 13, placeholder: "3", mdscore: 9, total: 3, correct: 0 },
          { index: 14, placeholder: "2", mdscore: 8, total: 2, correct: 0 }
        ]
      },
      {
        title: "聴解",
        questions: [
          { index: 1, placeholder: "5", mdscore: 10, total: 5, correct: 0 },
          { index: 2, placeholder: "6", mdscore: 12, total: 6, correct: 0 },
          { index: 3, placeholder: "5", mdscore: 10, total: 5, correct: 0 },
          { index: 4, placeholder: "11", mdscore: 12, total: 11, correct: 0 },
          { index: 5, placeholder: "3", mdscore: 16, total: 3, correct: 0 }
        ]
      }
    ],
    result: {
      vocabGrammar: 0,
      reading: 0,
      listening: 0,
      total: 0,
      pass: false,
      grade: { vocab: '', grammar: '', reading: '', listening: '' },
      date: ''
    },
    historyList: [],
    currentScoreData: null,
    error: false,       // 是否报错，用于高亮
    errorMsg: ''        // 错误提示信息

  },

  onLoad() {
    // 设置当天日期
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    this.setData({
      'result.date': `${y}/${m}/${d}`
    });

    // 加载历史记录
    this.loadHistory();
  },

  // 输入题目总数
  onInputTotal(e) {
    const { sid, qid } = e.currentTarget.dataset;
    let value = e.detail.value.trim();

    // 校验是否为正整数
    if (!/^\d+$/.test(value)) {
      wx.showToast({
        title: `第${qid}题总题数必须为数字`,
        icon: 'none'
      });
      value = 0;
    }

    value = Number(value);
    let sections = this.data.sections;
    let section = sections[sid];
    let q = section.questions.find(q => q.index == qid);
    if (q) {
      q.total = value > 0 ? value : 0;
      // 自动调整之前输入的正确数不超过总题数
      if (q.correct > q.total) {
        q.correct = q.total;
      }
    }
    this.setData({ sections });
  },

  // 输入正确数
  onInputCorrect(e) {
    const { sid, qid } = e.currentTarget.dataset;
    let value = e.detail.value.trim();

    // 校验是否为数字
    if (!/^\d+$/.test(value)) {
      wx.showToast({
        title: `第${qid}题正确数必须为数字`,
        icon: 'none'
      });
      value = 0;
    }

    value = Number(value);
    let sections = this.data.sections;
    let section = sections[sid];
    let q = section.questions.find(q => q.index == qid);
    if (q) {
      // 校验不超过总题数
      if (value > q.total) {
        wx.showToast({
          title: `第${qid}题正确数不能超过总题数 (${q.total})`,
          icon: 'none'
        });
        value = q.total;
      }
      q.correct = value;
    }
    this.setData({ sections });
  },

  // 计算分数
  calcScore() {
    const { sections, result } = this.data;
    let mg = 0, bp = 0, dk = 0, ck = 0;

    sections[0].questions.forEach(q => mg += (q.correct * q.mdscore) / q.total);
    sections[1].questions.forEach(q => bp += (q.correct * q.mdscore) / q.total);
    sections[2].questions.forEach(q => dk += (q.correct * q.mdscore) / q.total);
    sections[3].questions.forEach(q => ck += (q.correct * q.mdscore) / q.total);

    const vocabGrammar = Math.round(mg + bp);
    const reading = Math.round(dk);
    const listening = Math.round(ck);
    const total = vocabGrammar + reading + listening;

    const pass = (vocabGrammar >= 19 && reading >= 19 && listening >= 19 && total >= 90);

    function getGrade(score, full) {
      const ratio = score / full;
      if (ratio >= 0.67) return 'A';
      if (ratio >= 0.34) return 'B';
      return 'C';
    }

    const scoreData = {
      vocabGrammar,
      reading,
      listening,
      total,
      pass,
      grade: {
        vocab: getGrade(mg, 60),
        grammar: getGrade(bp, 60),
        reading: getGrade(dk, 60),
        listening: getGrade(ck, 60)
      },
      date: result.date,
      createTime: new Date()
    };

    this.setData({
      result: {
        ...result,
        ...scoreData
      },
      showPopup: true,
      showSaveBtn: true,
      currentScoreData: scoreData
    });
    this.saveScore();
  },

  // 保存分数到云数据库
  async saveScore() {
    try {
      const result = await scoreCollection.add({
        data: {
          ...this.data.currentScoreData,
          createTime: db.serverDate()
        }
      });

      // 重新加载历史记录
      this.loadHistory();
      this.setData({ showSaveBtn: false });

    } catch (error) {
      console.error('保存失败:', error);
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 加载历史记录
  async loadHistory() {
    try {
      const res = await scoreCollection
        .orderBy('createTime', 'desc')
        .limit(20)
        .get();

      this.setData({
        historyList: res.data
      });
    } catch (error) {
      console.error('加载历史记录失败:', error);
    }
  },

  // 显示历史记录弹窗
  showHistory() {
    this.loadHistory();
    this.setData({
      showHistoryPopup: true
    });
  },

  // 选择历史记录
  selectHistory(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      result: {
        ...this.data.result,
        ...item
      },
      showPopup: true,
      showHistoryPopup: false,
      showSaveBtn: false
    });
  },

  closePopup() {
    this.setData({
      showPopup: false,
      showSaveBtn: false
    });
  },

  closeHistoryPopup() {
    this.setData({ showHistoryPopup: false });
  }
});
