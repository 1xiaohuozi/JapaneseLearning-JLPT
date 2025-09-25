Page({
  data: {
    memoryGroups: [
      {
        icon: '🔗',
        title: '既然…就…',
        contentList: ['以上は', '上は', 'からには'],
        expanded: false
      },
      {
        icon: '😫',
        title: '……得不得了',
        contentList: ['〜てたまらない', '〜てしかたがない', '〜てしょうがない', '〜てならない', '〜て仕方がない'],
        expanded: false
      },
      {
        icon: '❓',
        title: '五个「不是不」',
        contentList: ['〜ないことはない', '〜ないではない', '〜なくはない', '〜ないものではない', '〜ないわけではない'],
        expanded: false
      },
      {
        icon: '❗',
        title: '必须/不得不',
        contentList: ['〜ないわけにはいかない', '〜ざるを得ない', '〜べきだ', '〜ねばならない', '〜なくてはならない', '〜なければならない'],
        expanded: false
      },
      {
        icon: '📌',
        title: '如果/假设',
        contentList: ['〜ば', '〜たら', '〜と', '〜なら'],
        expanded: false
      },
      {
        icon: '🔍',
        title: '好像/看起来',
        contentList: ['〜ようだ', '〜みたいだ', '〜らしい', '〜っぽい'],
        expanded: false
      },
      {
        icon: '🌀',
        title: '转折/出乎意料',
        contentList: ['〜のに', '〜くせに', '〜ながらも', '〜にもかかわらず', '〜というのに'],
        expanded: false
      },
      {
        icon: '🎯',
        title: '原因/理由',
        contentList: ['〜ため（に）', '〜ので', '〜から', '〜せいで', '〜ことだから'],
        expanded: false
      },
      {
        icon: '💬',
        title: '传闻/听说',
        contentList: ['〜そうだ（伝聞）', '〜らしい', '〜とか', '〜という'],
        expanded: false
      },
      {
        icon: '🌊',
        title: '状态加深/变化',
        contentList: ['〜つつある', '〜ばかりだ', '〜一方だ', '〜ようになってきた', '〜てくる'],
        expanded: false
      }
    ]
  },

  toggleExpand(e) {
    const index = e.currentTarget.dataset.index
    const updated = this.data.memoryGroups.map((item, i) => ({
      ...item,
      expanded: i === index ? !item.expanded : item.expanded
    }))
    this.setData({ memoryGroups: updated })
  }
})
