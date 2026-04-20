#!/usr/bin/env node
/**
 * check-pixabay-covers.js
 * 批量检测 Pixabay 第三方封面是否失效，输出失效菜谱列表
 * 
 * 用法：node scripts/check-pixabay-covers.js [--fix]
 *   --fix  自动为失效封面重新搜索 Pixabay 图片并更新数据库
 */

const { sequelize } = require('../db');
const Recipe = require('../models/Recipe');

const https = require('https');
const http = require('http');

// Pixabay 配置
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY || '';

// 超时设置
const TIMEOUT_MS = 8000;

// 第三方图片域名
const EXTERNAL_DOMAINS = [
  'cdn.pixabay.com',
  'pixabay.com',
  'images.pexels.com',
  'pexels.com',
];

function isExternalCover(cover) {
  if (!cover) return false;
  try {
    const url = new URL(cover);
    return EXTERNAL_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith('.' + d));
  } catch { return false; }
}

// HEAD 请求检查 URL 可达性
function checkUrl(url) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), TIMEOUT_MS);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'HEAD', timeout: TIMEOUT_MS }, (res) => {
      clearTimeout(timer);
      // 2xx/3xx 视为有效
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => { clearTimeout(timer); resolve(false); });
    req.on('timeout', () => { clearTimeout(timer); req.destroy(); resolve(false); });
    req.end();
  });
}

// Pixabay 搜索
function searchPixabay(query) {
  return new Promise((resolve) => {
    if (!PIXABAY_API_KEY) { resolve(null); return; }
    const url = `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&per_page=3&safesearch=true`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.hits && json.hits.length > 0) {
            resolve({ url: json.hits[0].webformatURL, source: 'Pixabay' });
          } else { resolve(null); }
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function extractKeywords(title) {
  // 去掉烹饪方式前缀
  let name = title.replace(/^(红烧|清蒸|凉拌|蒜蓉|糖醋|酸辣|水煮|干锅|黄焖|葱油|白灼|酱爆|爆炒|油炸|烤|葱烧|红烧|卤|腊|炖|煎|焖|烩|汆|溜|煲|炝|渍)/, '');
  // 去掉常见后缀
  name = name.replace(/(的家常做法|做法|简单版|简易版|快手版|经典版|正宗|超简单|不用烤箱|零失败|懒人版)$/i, '').trim();
  return name || title;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const fixMode = process.argv.includes('--fix');
  
  console.log('🔍 扫描所有菜谱的第三方封面...\n');
  
  const recipes = await Recipe.findAll({
    attributes: ['id', 'title', 'cover'],
  });

  // 筛选第三方封面
  const external = recipes.filter(r => isExternalCover(r.cover));
  console.log(`共 ${recipes.length} 道菜谱，${external.length} 道使用第三方封面\n`);

  if (external.length === 0) {
    console.log('✅ 没有第三方封面，无需检查');
    process.exit(0);
  }

  const broken = [];
  let checked = 0;

  for (const recipe of external) {
    checked++;
    process.stdout.write(`[${checked}/${external.length}] 检查 ${recipe.title}... `);
    
    const alive = await checkUrl(recipe.cover);
    if (!alive) {
      console.log('❌ 失效');
      broken.push(recipe);
    } else {
      console.log('✅ 正常');
    }
    
    // 避免请求过快
    await sleep(500);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`检查完成：${broken.length} 个失效 / ${external.length} 个第三方封面\n`);

  if (broken.length === 0) {
    console.log('🎉 全部正常');
    process.exit(0);
  }

  // 输出失效列表
  console.log('失效封面列表：');
  broken.forEach((r, i) => {
    console.log(`  ${i + 1}. [ID:${r.id}] ${r.title}`);
    console.log(`     ${r.cover}`);
  });

  // 修复模式
  if (fixMode) {
    if (!PIXABAY_API_KEY) {
      console.log('\n⚠️  未设置 PIXABAY_API_KEY 环境变量，无法自动修复');
      console.log('   请设置后重试：PIXABAY_API_KEY=xxx node scripts/check-pixabay-covers.js --fix');
      process.exit(1);
    }

    console.log('\n🔄 开始自动修复...\n');
    let fixed = 0, fixFailed = 0;

    for (const recipe of broken) {
      const kw = extractKeywords(recipe.title);
      process.stdout.write(`  修复 ${recipe.title} (关键词: ${kw})... `);
      
      const result = await searchPixabay(kw);
      if (result) {
        await recipe.update({ cover: result.url });
        console.log(`✅ → ${result.url.substring(0, 60)}...`);
        fixed++;
      } else {
        console.log('❌ 未找到替代图片');
        fixFailed++;
      }
      await sleep(1200);
    }

    console.log(`\n修复完成：${fixed} 成功，${fixFailed} 失败`);
  } else {
    console.log('\n提示：运行 node scripts/check-pixabay-covers.js --fix 可自动修复失效封面');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('脚本错误:', err.message);
  process.exit(1);
});
