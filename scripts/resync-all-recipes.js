/**
 * scripts/resync-all-recipes.js
 *
 * 全量重新同步：遍历所有本地 MD 文件，建立 PublishedArticle 关联，再同步菜谱
 *
 * 用法：
 *   node scripts/resync-all-recipes.js [--base-url http://localhost:3000] [--secret <secret>] [--dry-run]
 *
 * 流程：
 *   1. GET /api/published/list   — 获取已有关联（用于判断 article_md5 是否已存在）
 *   2. 遍历 articles/ 下所有 MD 文件
 *      2a. 提取标题（优先 front matter title:，否则 H1 heading）
 *      2b. 计算 article_md5 = MD5("标题|")（与后端一致）
 *      2c. POST /api/published/record  upsert PublishedArticle（幂等，已存在返回 skipped）
 *      2d. POST /api/recipe/parse       同步菜谱（findOrCreate，已存在则跳过）
 *   3. 打印汇总报告
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ============ 配置 =============
const ARTICLES_DIR = path.resolve(process.env.HOME, 'Desktop/wzmmaven/weikou/articles');
const BASE_URL = (() => {
  const idx = process.argv.indexOf('--base-url');
  return idx >= 0 ? process.argv[idx + 1] : 'https://express-yi42-246142-8-1421971309.sh.run.tcloudbase.com';
})();
const SECRET = (() => {
  const idx = process.argv.indexOf('--secret');
  return idx >= 0 ? process.argv[idx + 1] : 'published_record_secret_2026';
})();
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_COVER = process.argv.includes('--skip-cover');

function parseUrl(raw) {
  // 统一转为 URL 对象，避免协议/路径解析问题
  try { return new URL(raw); } catch { return null; }
}

// ============ HTTP 请求封装 =============
async function httpRequest(urlObj, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const mod = urlObj.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    };
    const req = mod.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('请求超时')));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function post(rawUrl, body) {
  const urlObj = parseUrl(rawUrl);
  return httpRequest(urlObj, { method: 'POST' }, body);
}

async function get(rawUrl) {
  const urlObj = parseUrl(rawUrl);
  return httpRequest(urlObj, { method: 'GET' });
}

// ============ 工具函数 =============
function computeArticleMd5(title, topic = '') {
  const content = `${title}|${topic || ''}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * 从 MD 文件内容提取标题
 * 优先取 front matter 的 title 字段，其次取第一个 H1 heading
 */
function extractTitle(content) {
  // front matter: 匹配 --- ... --- 块
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---\n/);
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^title:\s*(.+)/);
      if (m) return m[1].trim();
    }
  }
  // 第一个 H1 heading
  const h1Match = content.match(/^#\s+(.+)\n/);
  if (h1Match) return h1Match[1].trim();
  return null;
}

function extractDateFromFilename(filename) {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

function listMdFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && !f.includes('版权记录') && !f.includes('_cover'))
    .sort();
}

// ============ 核心逻辑 =============
async function main() {
  console.log(`\n🔄 全量菜谱重同步 (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Articles: ${ARTICLES_DIR}\n`);

  // Step 1: 获取已有关联（现有 article_md5 列表）
  console.log('📡 拉取已有关联记录...');
  let existingMd5Set = new Set();
  try {
    const listRes = await get(`${BASE_URL}/api/published/list?secret=${SECRET}`);
    if (listRes.success && listRes.data) {
      listRes.data.forEach(a => existingMd5Set.add(a.article_md5));
      console.log(`   已有 ${existingMd5Set.size} 条 PublishedArticle，列表已加载`);
    }
  } catch (e) {
    console.warn(`   ⚠️ 拉取失败，继续（将跳过 article_md5 判断）: ${e.message}`);
  }

  // Step 2: 遍历所有 MD 文件
  const files = listMdFiles(ARTICLES_DIR);
  console.log(`\n📂 找到 ${files.length} 个 MD 文件\n`);

  const stats = { total: files.length, upserted: 0, skipped: 0, synced: 0, errors: 0 };

  for (const filename of files) {
    const filePath = path.join(ARTICLES_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    const title = extractTitle(content);
    const dateStr = extractDateFromFilename(filename);
    const articleMd5 = computeArticleMd5(title || filename);
    const publishedAt = dateStr ? new Date(dateStr).toISOString() : undefined;

    const recipeCount = (content.match(/## 💕/g) || []).length;
    console.log(`[${filename}]`);
    console.log(`   标题: ${title || '(无标题)'}`);
    console.log(`   article_md5: ${articleMd5}`);
    console.log(`   菜谱数: ${recipeCount}`);

    if (DRY_RUN) {
      console.log('   ⏭️  DRY RUN，跳过\n');
      stats.skipped++;
      continue;
    }

    // Step 2a: upsert PublishedArticle（幂等）
    try {
      const recRes = await post(`${BASE_URL}/api/published/record?secret=${SECRET}`, {
        title: title || filename,
        topic: '',
        draft_id: '',
        article_md5: articleMd5,
        published_at: publishedAt,
      });
      if (recRes.success) {
        console.log(`   ${recRes.skipped ? '⏭️ 已存在（跳过）' : '✅ PublishedArticle 新增'}`);
        stats.upserted++;
      } else {
        console.warn(`   ⚠️ PublishedArticle 失败: ${recRes.error}`);
      }
    } catch (e) {
      console.error(`   ❌ PublishedArticle 接口失败: ${e.message}`);
      stats.errors++;
      continue;
    }

    // Step 2b: sync recipes
    try {
      const syncRes = await post(`${BASE_URL}/api/recipe/parse`, {
        markdown: content,
        articleId: articleMd5,   // 用 article_md5 作为 articleId
        publishedAt,
      });
      if (syncRes.success) {
        const count = syncRes.count || 0;
        console.log(`   ✅ 菜谱同步 ${count} 道`);
        stats.synced += count;
      } else {
        console.warn(`   ⚠️ 菜谱同步失败: ${syncRes.error}`);
      }
    } catch (e) {
      console.error(`   ❌ 菜谱同步失败: ${e.message}`);
      stats.errors++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // Step 3: 汇总
  console.log('\n' + '='.repeat(50));
  console.log('📊 汇总报告');
  console.log(`   文件总数: ${stats.total}`);
  console.log(`   PublishedArticle: ${stats.upserted}`);
  console.log(`   跳过: ${stats.skipped}`);
  console.log(`   菜谱入库: ${stats.synced} 道`);
  console.log(`   错误: ${stats.errors}`);
  console.log('='.repeat(50));

  if (!DRY_RUN && !SKIP_COVER && stats.synced > 0) {
    console.log('\n🚀 下一步：运行补封面脚本');
    console.log('   cd ~/Desktop/wzmmaven/wechat-food-publisher');
    console.log('   node scripts/fill-recipe-covers.js\n');
  } else if (DRY_RUN) {
    console.log('\n💡 去掉 --dry-run 参数即可真正执行\n');
  }
}

main().catch(err => {
  console.error('脚本异常:', err);
  process.exit(1);
});
