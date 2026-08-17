const fs = require('node:fs')
const path = require('node:path')

const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])

// electron-builder Arch 枚举数值 -> 架构名（与 @node-rs/jieba 目录命名对齐）
// 数值来自 electron-builder 的 builder-util Arch 枚举：
//   ia32=0 / x64=1 / armv7l=2 / arm64=3 / universal=4
const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
}

// 删除非目标平台 / 架构的 native 模块，只保留当前构建平台对应的模块
function cleanNativeModules(appOutDir, platform, arch) {
  const unpackedDir = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@node-rs')
  if (!fs.existsSync(unpackedDir)) return

  const targetPrefix = `jieba-${platform}`

  // macOS universal 构建同时包含 arm64 与 x64，需要保留这两个架构
  const archs = arch === 'universal' ? ['arm64', 'x64'] : [arch]

  for (const entry of fs.readdirSync(unpackedDir)) {
    const entryPath = path.join(unpackedDir, entry)
    if (!entry.startsWith('jieba-')) continue

    // 命中当前平台任一需保留架构的模块则保留，否则删除
    const shouldKeep = archs.some(
      (a) =>
        entry === `jieba-${platform}-${a}` || // darwin-x64 / darwin-arm64 这类无 ABI 后缀命名
        (entry.startsWith(targetPrefix) && entry.includes(`-${a}-`)) // 带 ABI 后缀命名
    )
    if (shouldKeep) continue

    fs.rmSync(entryPath, { recursive: true, force: true })
  }
}

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context

  // 清理 locales
  const localesDir = path.join(appOutDir, 'locales')
  if (fs.existsSync(localesDir)) {
    for (const fileName of fs.readdirSync(localesDir)) {
      if (KEEP_LOCALES.has(fileName)) continue
      fs.rmSync(path.join(localesDir, fileName), { force: true })
    }
  }

  // 根据当前构建平台 / 架构清理非目标 native 模块
  // electronPlatformName: 'darwin' | 'win32' | 'linux'
  const archName = ARCH_NAMES[arch] || 'x64'
  cleanNativeModules(appOutDir, electronPlatformName, archName)
}
