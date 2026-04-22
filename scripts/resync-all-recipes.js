/**
 * scripts/resync-all-recipes.js
 *
 * 全量重新同步：遍历所有本地 MD 文件，建立 PublishedArticle 关联，再同步菜谱
 *
 * 用法：
 *   node scripts/resync-all-recipes.js [--base-url http://localhost:3000] [--secret <secret>] [--dry-run]
 *
 * 流程：
 *   1. GET /api/published/list   — 获取已有的 published_articles，建立 title -> article_md5 映射
 *   2. 遍历 articles/ 下所有 MD 文件
 *      2a. 提取标题（优先 front matter title:，否则 H1 heading）
 *      2b. 按 title 查已有映射，命中则复用 article_md5 和 id，否则新建
 *      2c. POST /api/recipe/parse       同步菜谱（findOrCreate，已存在则跳过）
 *   3. 打印汇总报告
 *
 * 关键修复：之前 topic 传空字符串导致 MD5(title|) 和发布时的 MD5(title|真实topic) 对不上，
 * 现在改为直接从服务器已有记录反查 title 匹配，避免 MD5 不一致问题。
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

  // Step 1: 获取已有的 published_articles，建立 title -> { id, article_md5 } 映射
  console.log('📡 拉取已有的 published_articles 记录...');
  const titleMap = new Map(); // title -> { id, article_md5 }
  try {
    const listRes = await get(`${BASE_URL}/api/published/list?secret=${SECRET}`);
    if (listRes.success && listRes.data) {
      listRes.data.forEach(a => titleMap.set(a.title, { id: a.id, article_md5: a.article_md5 }));
      console.log(`   已有 ${titleMap.size} 条 PublishedArticle，按 title 索引`);
    }
  } catch (e) {
    console.warn(`   ⚠️ 拉取失败，继续（将无法关联已有记录）: ${e.message}`);
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
    const publishedAt = dateStr ? new Date(dateStr).toISOString() : undefined;

    const recipeCount = (content.match(/## 💕/g) || []).length;
    console.log(`[${filename}]`);
    console.log(`   标题: ${title || '(无标题)'}`);
    console.log(`   菜谱数: ${recipeCount}`);

    if (DRY_RUN) {
      console.log('   ⏭️  DRY RUN，跳过\n');
      stats.skipped++;
      continue;
    }

    // Step 2a: 从服务器已有记录中查找 title 匹配，复用正确的 article_md5
    let articleMd5 = null;
    let publishedArticleId = null;
    const existing = titleMap.get(title);
    if (existing) {
      articleMd5 = existing.article_md5;
      publishedArticleId = existing.id;
      console.log(`   📎 匹配已有记录: id=${publishedArticleId}, md5=${articleMd5}`);
    } else if (title) {
      // title 不存在，计算 MD5 并新建 PublishedArticle
      articleMd5 = computeArticleMd5(title);
      try {
        const recRes = await post(`${BASE_URL}/api/published/record?secret=${SECRET}`, {
          title,
          topic: '',
          draft_id: '',
          article_md5: articleMd5,
          published_at: publishedAt,
        });
        if (recRes.success) {
          if (recRes.skipped) {
            // 已存在但 titleMap 没命中（可能 title 不同但 md5 相同）
            // 用返回的 id 和 md5
            publishedArticleId = recRes.id;
            articleMd5 = recRes.article_md5 || articleMd5;
            console.log(`   ⏭️  PublishedArticle 已存在 (id=${publishedArticleId})`);
          } else {
            // 新建成功，record 接口直接返回了 id
            publishedArticleId = recRes.id;
            console.log(`   ✅ PublishedArticle 新增 (id=${publishedArticleId})`);
            stats.upserted++;
          }
          // 更新 titleMap
          titleMap.set(title, { id: publishedArticleId, article_md5: articleMd5 });
        } else {
          console.warn(`   ⚠️ PublishedArticle 失败: ${recRes.error}`);
        }
      } catch (e) {
        console.error(`   ❌ PublishedArticle 接口失败: ${e.message}`);
        stats.errors++;
        continue;
      }
    }

    // Step 2b: sync recipes（传正确的 articleMd5 和 publishedArticleId）
    try {
      const syncRes = await post(`${BASE_URL}/api/recipe/parse`, {
        markdown: content,
        articleId: articleMd5,
        articleMd5: articleMd5,
        publishedArticleId,
        publishedAt,
      });
      if (syncRes.success) {
        const count = syncRes.count || 0;
        console.log(`   ✅ 菜谱同步 ${count} 道，publishedArticleId=${publishedArticleId || '无'}`);
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
