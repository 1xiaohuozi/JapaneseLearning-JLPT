const WORD_BOOK_MANIFEST = require('../data/word-book-manifest')

const STORAGE_KEY = 'word_book_cache_manifest'
const memoryCache = {}

function getFileSystemManager() {
  return wx.getFileSystemManager()
}

function parseBookContent(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) return []

  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)

    return lines.map(line => JSON.parse(line))
  }
}

function readJsonFile(filePath) {
  const fs = getFileSystemManager()
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      encoding: 'utf8',
      success: res => {
        try {
          resolve(parseBookContent(res.data))
        } catch (error) {
          reject(error)
        }
      },
      fail: reject
    })
  })
}

function readCacheManifest() {
  return wx.getStorageSync(STORAGE_KEY) || {}
}

function writeCacheManifest(manifest) {
  wx.setStorageSync(STORAGE_KEY, manifest)
}

function getBookConfig(collection) {
  return WORD_BOOK_MANIFEST[collection] || null
}

function notifyProgress(callback, payload) {
  if (typeof callback === 'function') {
    callback(payload)
  }
}

function normalizeBook(list) {
  const normalizedList = Array.isArray(list) ? list : []
  const byId = {}
  normalizedList.forEach(item => {
    if (item && item._id) {
      byId[item._id] = item
    }
  })
  return {
    list: normalizedList,
    byId
  }
}

function downloadFileWithProgress(fileID, onProgress) {
  return new Promise((resolve, reject) => {
    const task = wx.cloud.downloadFile({
      fileID,
      success: resolve,
      fail: reject
    })

    if (task && typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate((progress) => {
        notifyProgress(onProgress, {
          phase: 'downloading',
          progress: Number(progress.progress || 0),
          totalBytesWritten: Number(progress.totalBytesWritten || 0),
          totalBytesExpectedToWrite: Number(progress.totalBytesExpectedToWrite || 0)
        })
      })
    }
  })
}

async function ensureDownloaded(collection, options = {}) {
  const config = getBookConfig(collection)
  if (!config || !config.fileID) {
    return { mode: 'cloud', list: [], byId: {} }
  }
  const onProgress = options.onProgress

  const cacheManifest = readCacheManifest()
  const cached = cacheManifest[collection]

  if (cached && cached.version === config.version && cached.savedFilePath) {
    try {
      notifyProgress(onProgress, { phase: 'reading-cache', progress: 100 })
      const parsed = await readJsonFile(cached.savedFilePath)
      return {
        mode: 'local',
        ...normalizeBook(parsed)
      }
    } catch (error) {
      // continue to re-download
    }
  }

  notifyProgress(onProgress, { phase: 'preparing', progress: 0 })
  const downloadRes = await downloadFileWithProgress(config.fileID, onProgress)
  notifyProgress(onProgress, { phase: 'saving', progress: 100 })

  const saveRes = await wx.saveFile({
    tempFilePath: downloadRes.tempFilePath
  })

  const nextManifest = {
    ...cacheManifest,
    [collection]: {
      version: config.version,
      savedFilePath: saveRes.savedFilePath,
      cachedAt: Date.now()
    }
  }
  writeCacheManifest(nextManifest)

  notifyProgress(onProgress, { phase: 'parsing', progress: 100 })
  const parsed = await readJsonFile(saveRes.savedFilePath)
  return {
    mode: 'local',
    ...normalizeBook(parsed)
  }
}

async function getWordBook(collection, options = {}) {
  const cacheKey = `${collection}:${getBookConfig(collection)?.version || 'cloud'}`
  if (memoryCache[cacheKey]) return memoryCache[cacheKey]

  const result = await ensureDownloaded(collection, options)
  memoryCache[cacheKey] = result
  return result
}

function hasLocalWordBook(collection) {
  const config = getBookConfig(collection)
  return !!(config && config.fileID)
}

module.exports = {
  getWordBook,
  hasLocalWordBook
}
