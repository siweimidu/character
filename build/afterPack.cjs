const fs = require('node:fs')
const path = require('node:path')

const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])

// 删除非目标平台的 native 模块，只保留 win32-x64
function cleanNativeModules(appOutDir, platform, arch) {
  const unpackedDir = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@node-rs')
  if (!fs.existsSync(unpackedDir)) return

  const targetPrefix = `jieba-${platform}`
  const targetSuffix = `${platform}-${arch}-msvc`
  const targetArch = `win32-${arch}-msvc`

  for (const entry of fs.readdirSync(unpackedDir)) {
    const entryPath = path.join(unpackedDir, entry)
    if (!entry.startsWith('jieba')) continue
    if (!entry.startsWith('jieba-')) continue

    // 只保留 win32-x64 的模块
    if (entry.includes(targetArch)) continue

    // 删除其他平台的模块
    fs.rmSync(entryPath, { recursive: true, force: true })
  }
}

module.exports = async function afterPack(context) {
  const { appOutDir } = context

  // 清理 locales
  const localesDir = path.join(appOutDir, 'locales')
  if (fs.existsSync(localesDir)) {
    for (const fileName of fs.readdirSync(localesDir)) {
      if (KEEP_LOCALES.has(fileName)) continue
      fs.rmSync(path.join(localesDir, fileName), { force: true })
    }
  }

  // 清理非 win32-x64 的 native 模块
  cleanNativeModules(appOutDir, 'win32', 'x64')
}
