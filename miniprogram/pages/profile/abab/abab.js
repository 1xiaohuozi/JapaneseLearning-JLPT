Page({
  data: {
    vocabData: [
      {
        icon: "✨",
        category: "表示状态或变化的词",
        words: [
          { word: "いよいよ", meaning: "终于", example: "いよいよ日本へ出発する時がきた。" },
          { word: "ぎりぎり", meaning: "极限，刚好", example: "ぎりぎり間に合う。" },
          { word: "どんどん", meaning: "顺利，连续不断", example: "金をどんどんつかう。" },
          { word: "そろそろ", meaning: "就要，快要", example: "そろそろ帰る。" },
          { word: "たまたま", meaning: "偶然", example: "たまたま通り掛かって老人が倒れるのを見た。" },
          { word: "すくすく", meaning: "茁壮成长", example: "すくすく育つ。" }
        ]
      },
      {
        icon: "😫",
        category: "表示负面情绪或身体不适",
        words: [
          { word: "いらいら", meaning: "烦躁", example: "待ち人が来なくていらいらする。" },
          { word: "ぐずぐず", meaning: "磨蹭，拖拉", example: "ぐずぐずと返事を延ばす。" },
          { word: "くよくよ", meaning: "耿耿于怀", example: "くよくよ気にする。" },
          { word: "ぶつぶつ", meaning: "抱怨", example: "ぶつぶつ言う。" },
          { word: "もたもた", meaning: "拖拉，犹豫", example: "もたもたして好機を逃す。" },
          { word: "へとへと", meaning: "精疲力尽", example: "はげしい運動でへとへとになる。" },
          { word: "どきどき", meaning: "怦怦跳，紧张", example: "心臓がどきどきする。" },
          { word: "まごまご", meaning: "不知所措", example: "出口がわからずまごまごした。" }
        ]
      },
      {
        icon: "😊",
        category: "表示积极情绪或动作状态",
        words: [
          { word: "にこにこ", meaning: "笑眯眯", example: "彼はいつもにこにこしている。" },
          { word: "にやにや", meaning: "偷笑，冷笑", example: "何をにやにやしているんだ。" },
          { word: "はきはき", meaning: "干脆利落", example: "彼女ははきはき答えた。" },
          { word: "すらすら", meaning: "流畅", example: "すらすら話す。" },
          { word: "べらべら", meaning: "喋喋不休", example: "1時間もべらべらとしゃべりつづける。" },
          { word: "ぺらぺら", meaning: "语言流利", example: "ぺらぺらと英語を話す。" },
          { word: "わくわく", meaning: "兴奋，激动", example: "わくわくして待つ。" }
        ]
      },
      {
        icon: "👣",
        category: "表示动作状态（走动、徘徊）",
        words: [
          { word: "うろうろ", meaning: "徘徊，转来转去", example: "うろうろ歩き回る。" },
          { word: "ぶらぶら", meaning: "溜达，闲逛", example: "公園をぶらぶら歩きましょう。" },
          { word: "ふらふら", meaning: "摇晃，蹒跚", example: "ふらふらしながら歩く。" },
          { word: "のろのろ", meaning: "缓慢，迟钝", example: "のろのろとバスに戻った。" },
          { word: "ぞろぞろ", meaning: "络绎不绝", example: "子どもがぞろぞろついてくる。" },
        ],
      },
      {
        icon: "🎧",
        category: "拟声词（声音/自然状态）",
        words: [
          { word: "がやがや", meaning: "吵吵嚷嚷", example: "がやがや騒ぐ。" },
          { word: "ざあざあ", meaning: "哗啦哗啦（雨）", example: "雨がざあざあ降る。" },
          { word: "さらさら", meaning: "沙沙（树叶）", example: "木の葉のさらさらという音。" },
          { word: "しとしと", meaning: "淅淅沥沥", example: "雨がしとしと降る。" },
          { word: "そよそよ", meaning: "微风轻拂", example: "風がそよそよと吹く。" },
          { word: "ごろごろ", meaning: "雷声，滚动声；懒散状态", example: "家でごろごろしている。" },
          { word: "げらげら", meaning: "哈哈大笑", example: "げらげら笑う。" },
        ],
      },
      {
        icon: "💡",
        category: "表示事物状态（表面、质地、外观）",
        words: [
          { word: "かさかさ", meaning: "干燥  ", example: "手がかさかさになる。" },
          { word: "ざらざら", meaning: "粗糙  ", example: "ざらざらした壁。" },
          { word: "つるつる", meaning: "光滑  ", example: "皮膚がつるつるになります。" },
          { word: "ぴかぴか", meaning: "闪闪发光  ", example: "星がぴかぴか輝いていた。" },
          { word: "ふわふわ", meaning: "轻飘飘  ", example: "羽毛がふわふわと飛んでいた。" },
          { word: "だぶだぶ", meaning: "肥大  ", example: "ズボンがだぶだぶする。" },
        ],
      },
      {
        icon: "📚",
        category: "表示杂乱或混乱",
        words: [
          { word: "ごたごた", meaning: "混乱", example: "家の中がごたごたしている。" },
          { word: "ばらばら", meaning: "零散，分裂", example: "おもちゃがばらばらに散らばっていた。" },
          { word: "ぼろぼろ", meaning: "破旧，掉落", example: "ぼろぼろの服を着ていた。" },
        ],
      },
      {
        icon: "📍",
        category: "其他常用词",
        words: [
          { word: "おのおの", meaning: "各自", example: "弁当はおのおのが持参する。" },
          { word: "めいめい", meaning: "各自", example: "めいめいの好みが表れていた。" },
          { word: "すみずみ", meaning: "各个角落", example: "建物の隅々まで捜査した。" },
          { word: "すきずき", meaning: "各有所好", example: "人にはそれぞれ好き好きがある。" },
          { word: "せいぜい", meaning: "顶多", example: "あの女の子はせいぜい9歳だ。" },
        ],
      },
    ]
  }
});
