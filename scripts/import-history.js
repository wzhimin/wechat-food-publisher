#!/usr/bin/env node
/**
 * 历史文章批量导入 - 调用云端 /api/recipe/parse 接口
 * 运行: node scripts/import-history.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = 'https://express-yi42-246142-8-1421971309.sh.run.tcloudbase.com';

const articlesDir = path.join(process.env.HOME, 'Downloads', '公众号文章');

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path, API_BASE);
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const files = fs.readdirSync(articlesDir)
    .filter(f => f.endsWith('.md') && !f.includes('_cover'))
    .sort();

  if (files.length === 0) {
    console.log('没有找到 .md 文件');
    return;
  }

  console.log(`找到 ${files.length} 篇文章，开始导入...\n`);

  let total = 0;
  for (const file of files) {
    const filePath = path.join(articlesDir, file);
    const markdown = fs.readFileSync(filePath, 'utf-8');
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_/);
    const publishedAt = dateMatch ? `${dateMatch[1]}T00:00:00.000Z` : new Date().toISOString();

    try {
      const res = await post('/api/recipe/parse', {
        markdown,
        articleId: `imported_${file}`,
        publishedAt,
      });
      const count = res.count || 0;
      total += count;
      console.log(`✅ [${file}] 入库 ${count} 道菜`);
      if (res.data) {
        res.data.forEach(r => console.log(`   - ${r.title}`));
      }
    } catch (err) {
      console.log(`❌ [${file}] 失败: ${err.message}`);
    }
  }

  console.log(`\n完成，共入库 ${total} 道菜`);
}

main().catch(err => {
  console.error('运行失败:', err.message);
  process.exit(1);
});
