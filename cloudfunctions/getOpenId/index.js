// 云函数入口文件
const cloud = require('zyzl-3gawcivd998e58ad')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数 cloudfunctions/getOpenId/index.js
exports.main = async (event, context) => {
  return {
    openid: context.OPENID
  }
}
