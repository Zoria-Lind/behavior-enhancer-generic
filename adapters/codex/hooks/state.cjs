// behavior-enhancer — Codex 适配器状态层。
// Codex hooks 是每事件独立进程,状态落盘于 ~/.behavior-enhancer/codex/(可被
// BEHAVIOR_ENHANCER_STATE_DIR 覆盖,测试用)。所有读写 fail-open:异常时返回
// 默认状态/放弃写入,绝不阻断工具。
// 跨进程互斥:mkdir 锁(原子),超时 fail-open。

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const BASE = process.env.BEHAVIOR_ENHANCER_STATE_DIR
  || path.join(os.homedir(), '.behavior-enhancer', 'codex')
const STATE_FILE = path.join(BASE, 'state.json')
const INFLIGHT_DIR = path.join(BASE, 'inflight')
const SNAPSHOT_DIR = path.join(BASE, 'snapshots')
const LOCK_DIR = path.join(BASE, '.lock')

const STATS_ZERO = {
  'hardGate.denied': 0,
  'hardGate.escape': 0,
  'postWriteCheck.rollbacks': 0,
  'behavior.failures': 0,
  'behavior.alerts': 0,
  'behavior.serialized': 0,
  'behavior.restored': 0,
  'readBeforeWrite.denied': 0,
  'readBeforeWrite.warns': 0,
}

function defaults() {
  return {
    readRegistry: {}, // 绝对路径 → { ranges: [[s,e],...], at: ms }
    tier: 0, // 0=不限;1=失败串行档;3=恢复档
    successStreak: 0,
    streaks: {}, // tool → 连续失败次数
    strikes: {}, // reason → 已拦截次数
    pending: {}, // filePath → { snapPath, existed, at }(写前快照登记)
    pendingCalls: {}, // toolUseId → filePath[](apply_patch 一次多文件)
    stats: { ...STATS_ZERO },
  }
}

function ensureDirs() {
  try {
    fs.mkdirSync(BASE, { recursive: true })
    fs.mkdirSync(INFLIGHT_DIR, { recursive: true })
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  } catch { /* fail-open */ }
}

// ---- 跨进程锁(mkdir 原子性;超时 fail-open) ----
function withLock(fn, timeoutMs = 1500) {
  ensureDirs()
  const start = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR)
      break
    } catch {
      if (Date.now() - start > timeoutMs) return fn() // 拿不到锁:fail-open 直跑
      const until = Date.now() + 20
      while (Date.now() < until) { /* 自旋 20ms */ }
    }
  }
  try {
    return fn()
  } finally {
    try { fs.rmdirSync(LOCK_DIR) } catch { /* 锁已被他人持有(不可能,但防呆) */ }
  }
}

function load() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...defaults(), ...parsed, stats: { ...STATS_ZERO, ...(parsed.stats ?? {}) } }
  } catch {
    return defaults()
  }
}
function save(state) {
  try {
    ensureDirs()
    const tmp = STATE_FILE + '.tmp-' + process.pid
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8')
    fs.renameSync(tmp, STATE_FILE)
  } catch { /* 落盘失败不致命 */ }
}
function mutate(fn, timeoutMs = 1500) {
  return withLock(() => {
    const state = load()
    const out = fn(state)
    save(state)
    return out
  }, timeoutMs)
}

// ---- in-flight 计数(每调用一个条目文件;age 超阈值视为死进程残留) ----
function inflightCount(now = Date.now()) {
  try {
    const names = fs.readdirSync(INFLIGHT_DIR)
    let n = 0
    for (const name of names) {
      try {
        const st = fs.statSync(path.join(INFLIGHT_DIR, name))
        if (now - st.mtimeMs < 5 * 60 * 1000) n++
      } catch { /* 条目消失:不计 */ }
    }
    return n
  } catch { return 0 }
}
function inflightAdd(toolUseId) {
  try {
    ensureDirs()
    fs.writeFileSync(path.join(INFLIGHT_DIR, String(toolUseId).replace(/[^0-9A-Za-z_-]/g, '_')), String(Date.now()), 'utf8')
  } catch { /* fail-open */ }
}
function inflightRemove(toolUseId) {
  try {
    fs.unlinkSync(path.join(INFLIGHT_DIR, String(toolUseId).replace(/[^0-9A-Za-z_-]/g, '_')))
  } catch { /* 不存在 */ }
}

// ---- 写前快照(存在才拍;新文件登记 existed=false) ----
function snapshot(filePath) {
  try {
    const existed = fs.existsSync(filePath)
    const key = String(filePath).replace(/[^0-9A-Za-z_.-]/g, '_').slice(-120)
    const snapPath = path.join(SNAPSHOT_DIR, key + '.bak-' + Date.now() + '-' + process.pid)
    if (existed) fs.copyFileSync(filePath, snapPath)
    else fs.writeFileSync(snapPath, '', 'utf8') // 占位:标记"文件本不存在"
    return { snapPath, existed }
  } catch {
    return null
  }
}
function rollback(snap, filePath) {
  try {
    if (snap.existed) fs.copyFileSync(snap.snapPath, filePath)
    else {
      fs.rmSync(filePath, { force: true })
      try { fs.unlinkSync(snap.snapPath) } catch { /* 占位快照清理失败不致命 */ }
    }
    return true
  } catch {
    return false
  }
}

module.exports = {
  BASE, STATE_FILE, INFLIGHT_DIR, SNAPSHOT_DIR, STATS_ZERO,
  defaults, ensureDirs, withLock, load, save, mutate,
  inflightCount, inflightAdd, inflightRemove, snapshot, rollback,
}
