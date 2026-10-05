// behavior-enhancer — Pi 适配器状态层(进程内)。
// Pi extension 跑在 pi 进程内(单事件循环)→ 无跨进程竞态,计数/快照用模块内存,
// 持久层落盘 ~/.behavior-enhancer/pi/state.json(可被 BEHAVIOR_ENHANCER_STATE_DIR
// 覆盖,测试用)。铁律:任何异常 fail-open,绝不阻断工具。

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const BASE = process.env.BEHAVIOR_ENHANCER_STATE_DIR
  || path.join(os.homedir(), '.behavior-enhancer', 'pi')
const STATE_FILE = path.join(BASE, 'state.json')

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
    stats: { ...STATS_ZERO },
  }
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return { ...defaults(), ...parsed, stats: { ...STATS_ZERO, ...(parsed.stats ?? {}) } }
  } catch {
    return defaults()
  }
}
function save() {
  try {
    fs.mkdirSync(BASE, { recursive: true })
    const tmp = STATE_FILE + '.tmp-' + process.pid
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8')
    fs.renameSync(tmp, STATE_FILE)
  } catch { /* 落盘失败不致命 */ }
}

const state = load()

// ---- 进程内瞬态(可再生;重启从文件恢复 tier/streaks/strikes/stats) ----
const inFlight = new Set() // 正在执行的 toolCallId
const snapshots = new Map() // toolCallId → { filePath, content, existed }

function bump(key) {
  try {
    state.stats[key] = (state.stats[key] ?? 0) + 1
    save()
  } catch { /* 统计失败不致命 */ }
}

// ---- in-flight(进程内,天然原子) ----
function inflightAdd(toolCallId) { inFlight.add(toolCallId) }
function inflightRemove(toolCallId) { inFlight.delete(toolCallId) }
function inflightCount() { return inFlight.size }

// ---- 写前快照(内存;Pi 进程内无需磁盘 .bak 也能回滚;文件跨会话恢复属 v1.1) ----
function snapshotRegister(toolCallId, filePath, content) {
  snapshots.set(toolCallId, { filePath, content, existed: true })
}
function snapshotRegisterNew(toolCallId, filePath) {
  snapshots.set(toolCallId, { filePath, content: '', existed: false })
}
function snapshotTake(toolCallId) {
  const s = snapshots.get(toolCallId)
  snapshots.delete(toolCallId)
  return s ?? null
}

module.exports = {
  STATE_FILE, STATS_ZERO, state, defaults, load, save, bump,
  inflightAdd, inflightRemove, inflightCount,
  snapshotRegister, snapshotRegisterNew, snapshotTake,
}
