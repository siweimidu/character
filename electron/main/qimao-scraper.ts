import { BrowserWindow } from 'electron'

/**
 * 七猫排行榜自动抓取器
 *
 * 七猫官网带阿里云 WAF 反爬（简单 HTTP 请求会命中滑动验证码），
 * 但真实 Chromium（Electron 内嵌）具备完整浏览器指纹，可正常通过。
 * 这里用隐藏的 BrowserWindow 加载七猫榜单页，再通过 webContents.executeJavaScript
 * 提取结构化榜单数据，从而把「手动粘贴书单」升级为「一键自动抓取」。
 *
 * 参考工作流：https://github.com/Yunshiro/yunn-skills 的 qimao-novel-scraper
 * 榜单 URL 规律：https://www.qimao.com/paihang/{sex}/{type}/{date|month}/
 *   sex: boy 男频 / girl 女频
 *   type: new 新书榜 / hot 热销榜 / finish 完结榜
 */

export interface QimaoScrapedBook {
  rank: number
  title: string
  author: string
  genre: string
  subGenre: string
  status: string
  words: string
  heat: string
  update: string
  intro: string
  url: string
}

export interface QimaoScrapeResult {
  success: boolean
  channelLabel: string
  boardLabel: string
  books: QimaoScrapedBook[]
  error?: string
  scrapedAt: string
}

const SEX_LABELS: Record<string, string> = { boy: '男频', girl: '女频', all: '综合' }
const TYPE_LABELS: Record<string, string> = { new: '新书榜', hot: '热销榜', finish: '完结榜' }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 提取脚本：从榜单页 DOM 中解析结构化书籍数据 */
function buildExtractScript(): string {
  // 通过 webContents.executeJavaScript 注入，返回 JSON 字符串。
  return `
    (() => {
      const collect = () => {
        const seen = new Set();
        const books = [];
        // 尝试从卡片容器提取；容器结构随版本变化，用通用扫描兜底
        const candidates = document.querySelectorAll('a[href*="/shuku/"]');
        const anchors = Array.from(candidates);
        for (const a of anchors) {
          const href = a.getAttribute('href') || a.href || '';
          const m = href.match(/\\/shuku\\/(\\d+)/);
          const title = (a.textContent || '').trim();
          if (m && !seen.has(m[1]) && title && title.length < 40) {
            seen.add(m[1]);
            // 向上找最近的卡片容器
            let card = a;
            for (let i = 0; i < 5 && card; i++) {
              if ((card.textContent || '').length > 40) break;
              card = card.parentElement;
            }
            const cardText = card ? (card.textContent || '').replace(/\\s+/g, ' ').trim() : '';
            books.push({ bookId: m[1], title, url: 'https://www.qimao.com/shuku/' + m[1] + '/', cardText });
          }
        }
        return books;
      };
      return JSON.stringify(collect());
    })()
  `
}

/** 提取完整书籍信息（含简介、热度、作者、题材等） */
function buildDetailExtractScript(): string {
  return `
    (() => {
      const text = (document.body && document.body.innerText) || '';
      const lines = text.split(/\\n/).map(s => s.trim()).filter(Boolean);
      const books = [];
      let cur = null;
      let fieldIdx = 0;
      const startIdx = lines.findIndex(l => /^(大热榜|新书榜|完结榜|热销榜|日榜|月榜)/.test(l));
      const source = startIdx >= 0 ? lines.slice(startIdx) : lines;
      for (const line of source) {
        // 排名标记：独立 1-2 位数字
        if (/^\\d{1,2}$/.test(line) && parseInt(line, 10) < 100) {
          if (cur && cur.title) books.push(cur);
          cur = { rank: parseInt(line, 10), title: '', author: '', genre: '', subGenre: '', status: '', words: '', heat: '', update: '', intro: '' };
          fieldIdx = 0;
          continue;
        }
        if (!cur) continue;
        if (/^(加入书架|立即阅读|蝉联|榜首|上一页|下一页)/.test(line)) continue;
        const hm = line.match(/([\\d.]+)\\s*万\\s*热度/);
        if (hm) { cur.heat = hm[1] + '万'; continue; }
        if (line.indexOf('最近更新') === 0) { cur.update = line.replace(/^最近更新\\s*/, ''); continue; }
        if (/^(连载中|已完结)$/.test(line)) { cur.status = line; continue; }
        if (/^[\\d.]+万字$/.test(line)) { cur.words = line; continue; }
        if (fieldIdx === 0) { cur.title = line; fieldIdx = 1; continue; }
        if (fieldIdx === 1) { cur.author = line; fieldIdx = 2; continue; }
        if (fieldIdx === 2) { cur.genre = line; fieldIdx = 3; continue; }
        if (fieldIdx === 3) { cur.subGenre = line; fieldIdx = 4; continue; }
        cur.intro += (cur.intro ? ' ' : '') + line;
      }
      if (cur && cur.title) books.push(cur);
      return JSON.stringify(books);
    })()
  `
}

/** 在页面加载后滚动加载更多榜单条目 */
function buildScrollScript(): string {
  return `
    (async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await wait(800);
      }
      return true;
    })()
  `
}

export interface QimaoScrapeOptions {
  sex?: string
  type?: string
  period?: 'date' | 'month'
}

/**
 * 抓取指定七猫榜单。
 * @param options.sex boy/girl
 * @param options.type new/hot/finish
 * @param options.period date/month
 */
export async function scrapeQimaoRank(options: QimaoScrapeOptions = {}): Promise<QimaoScrapeResult> {
  const sex = options.sex === 'girl' ? 'girl' : options.sex === 'all' ? 'all' : 'boy'
  const type = ['hot', 'finish'].includes(options.type ?? '') ? (options.type as string) : 'new'
  const period = options.period === 'month' ? 'month' : 'date'

  const url = sex === 'all'
    ? `https://www.qimao.com/paihang/${type}/${period}/`
    : `https://www.qimao.com/paihang/${sex}/${type}/${period}/`

  let win: BrowserWindow | null = null
  const scrapedAt = new Date().toISOString()

  try {
    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        // 禁用 node 集成以模拟普通浏览器环境，规避被 WAF 识别
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // 允许加载第三方脚本（qimao 页面依赖）
        javascript: true
      }
    })

    // 拦截新窗口（页面可能弹窗），统一在当前窗口处理
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    // 加载榜单页（带超时保护，避免 WAF 校验时挂起）
    await Promise.race([
      win.loadURL(url),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('七猫榜单页加载超时')), 20000))
    ])
    // 等待页面渲染
    await sleep(3500)

    // 滚动加载更多
    try {
      await win.webContents.executeJavaScript(buildScrollScript(), true)
    } catch {
      // 忽略滚动失败
    }
    await sleep(1500)

    // 1) 先用文本解析获取结构化字段
    const detailRaw = await win.webContents.executeJavaScript(buildDetailExtractScript(), true)
    let detailBooks: Array<Record<string, unknown>> = []
    try {
      const parsed = JSON.parse(String(detailRaw))
      if (Array.isArray(parsed)) detailBooks = parsed as Array<Record<string, unknown>>
    } catch {
      // 解析失败则降级用链接提取
    }

    // 2) 用链接提取补充 URL
    const linksRaw = await win.webContents.executeJavaScript(buildExtractScript(), true)
    let linkBooks: Array<Record<string, unknown>> = []
    try {
      const parsed = JSON.parse(String(linksRaw))
      if (Array.isArray(parsed)) linkBooks = parsed as Array<Record<string, unknown>>
    } catch {
      // 忽略
    }

    const linkByTitle = new Map<string, string>()
    for (const lb of linkBooks) {
      const t = String(lb.title ?? '').trim()
      const u = String(lb.url ?? '')
      if (t && u) linkByTitle.set(t, u)
    }

    const books: QimaoScrapedBook[] = detailBooks.slice(0, 50).map((b) => {
      const title = String(b.title ?? '').trim()
      return {
        rank: Number(b.rank) || 0,
        title,
        author: String(b.author ?? '').trim(),
        genre: String(b.genre ?? '').trim(),
        subGenre: String(b.subGenre ?? '').trim(),
        status: String(b.status ?? '').trim(),
        words: String(b.words ?? '').trim(),
        heat: String(b.heat ?? '').trim(),
        update: String(b.update ?? '').trim(),
        intro: String(b.intro ?? '').trim().slice(0, 300),
        url: linkByTitle.get(title) || ''
      }
    }).filter((b) => b.title)

    if (books.length === 0) {
      // 文本解析没拿到，退回链接数据
      for (const lb of linkBooks) {
        const title = String(lb.title ?? '').trim()
        if (!title) continue
        books.push({
          rank: books.length + 1,
          title,
          author: '',
          genre: '',
          subGenre: '',
          status: '',
          words: '',
          heat: '',
          update: '',
          intro: '',
          url: String(lb.url ?? '')
        })
      }
    }

    if (books.length === 0) {
      return {
        success: false,
        channelLabel: SEX_LABELS[sex] ?? sex,
        boardLabel: TYPE_LABELS[type] ?? type,
        books: [],
        error: '未从七猫页面解析到榜单数据，页面结构可能已调整或触发了安全校验。',
        scrapedAt
      }
    }

    return {
      success: true,
      channelLabel: SEX_LABELS[sex] ?? sex,
      boardLabel: TYPE_LABELS[type] ?? type,
      books,
      scrapedAt
    }
  } catch (error) {
    return {
      success: false,
      channelLabel: SEX_LABELS[sex] ?? sex,
      boardLabel: TYPE_LABELS[type] ?? type,
      books: [],
      error: error instanceof Error ? error.message : '七猫榜单抓取失败',
      scrapedAt
    }
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
  }
}

/** 供渲染进程调用的公开入口（带超时保护） */
export async function fetchQimaoRank(options: QimaoScrapeOptions = {}): Promise<QimaoScrapeResult> {
  return scrapeQimaoRank(options)
}
