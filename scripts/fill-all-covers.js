#!/usr/bin/env node
/**
 * 全量封面修复脚本
 * 处理：无封面 + 无效URL（mmbiz被拦截/404/400/无效路径）
 * 
 * 流程：
 * 1. 拉全量菜谱
 * 2. 对有封面的做 HTTP HEAD 检测
 * 3. mmbiz.qpic.cn 直接判定无效（小程序拦截）
 * 4. 调 fill-recipe-covers 的 fillCoversForRecipes 补封面
 */

const https = require('https');
const http = require('http');

const API_BASE = process.env.API_BASE || 'https://express-yi42-246142-8-1421971309.sh.run.tcloudbase.com';
const { fillCoversForRecipes } = require('./fill-recipe-covers');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    }).on('error', reject);
  });
}

// HTTP HEAD 检测 URL 是否可访问
function checkUrl(urlStr) {
  return new Promise((resolve) => {
    if (!urlStr || urlStr === 'cover.jpg') {
      resolve(false);
      return;
    }
    // mmbiz.qpic.cn 在小程序被拦截，直接判无效
    if (urlStr.includes('mmbiz.qpic.cn')) {
      resolve(false);
      return;
    }
    // 相对路径拼完整
    const fullUrl = urlStr.startsWith('http') ? urlStr : `${API_BASE}${urlStr}`;
    
    const protocol = fullUrl.startsWith('https') ? https : http;
    const req = protocol.request(fullUrl, { method: 'HEAD', timeout: 8000 }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  味口小程序 - 全量封面修复工具');
  console.log('═══════════════════════════════════════\n');

  // 解析参数
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipCheck = args.includes('--skip-check'); // 跳过URL检测，只补空封面
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]) || 999;

  console.log(`📡 后端地址: ${API_BASE}`);
  console.log(`🔧 模式: ${dryRun ? '试运行' : '正式模式'}`);
  console.log(`🤖 图片来源: 通义万相 AI（唯一来源）`);
  console.log(`🔍 URL检测: ${skipCheck ? '跳过（只补空封面）' : '开启（检测失效URL）'}`);
  console.log(`📊 上限: ${limit}\n`);

  // 拉全量菜谱
  console.log('📦 拉取菜谱数据...');
  let allRecipes = [];
  let page = 1;
  while (true) {
    const res = await httpGet(`/api/recipe/list?page=${page}&pageSize=200`);
    if (!res.success) {
      console.error('❌ 拉取失败:', res);
      process.exit(1);
    }
    allRecipes = allRecipes.concat(res.data);
    if (allRecipes.length >= res.total || res.data.length === 0) break;
    page++;
  }
  console.log(`📊 总共 ${allRecipes.length} 道菜谱\n`);

  // 分类
  const emptyCover = allRecipes.filter(r => !r.cover || r.cover === '' || r.cover === 'cover.jpg');
  const hasCover = allRecipes.filter(r => r.cover && r.cover !== '' && r.cover !== 'cover.jpg');

  console.log(`📭 无封面: ${emptyCover.length}`);
  console.log(`📎 有封面: ${hasCover.length}（${skipCheck ? '跳过检测' : '检测中...'}）\n`);

  let invalidCover = [];
  if (!skipCheck) {
    // 检测有封面的URL是否有效
    for (let i = 0; i < hasCover.length; i++) {
      const r = hasCover[i];
      // mmbiz 直接判无效
      if (r.cover.includes('mmbiz.qpic.cn')) {
        invalidCover.push(r);
        console.log(`  ❌ [${i+1}/${hasCover.length}] id=${r.id} ${r.title} → 微信素材被拦截`);
        continue;
      }
      const valid = await checkUrl(r.cover);
      if (!valid) {
        invalidCover.push(r);
        console.log(`  ❌ [${i+1}/${hasCover.length}] id=${r.id} ${r.title} → URL失效`);
      } else {
        // 只打印前几个有效的，避免刷屏
        if (i < 3) console.log(`  ✅ [${i+1}/${hasCover.length}] id=${r.id} ${r.title} → 有效`);
      }
      // 检测间隔，避免过快
      if (i % 20 === 19) await sleep(500);
    }
    console.log(`\n📊 URL检测完成: 有效 ${hasCover.length - invalidCover.length}, 失效 ${invalidCover.length}`);
  }

  // 合并需要补封面的列表
  // 对有cover但URL失效的，清空cover字段让 fillCoversForRecipes 能处理
  const needFill = [...emptyCover, ...invalidCover].map(r => ({
    ...r,
    cover: '' // 统一清空，让 fillCoversForRecipes 识别为需要补封面
  })).slice(0, limit);
  console.log(`\n🎯 需要补封面: ${needFill.length} 道\n`);

  if (needFill.length === 0) {
    console.log('✅ 所有封面都正常！');
    process.exit(0);
  }

  // 打印列表
  console.log('待处理菜谱:');
  needFill.forEach((r, i) => {
    const reason = !r.cover || r.cover === 'cover.jpg' ? '无封面' :
                   r.cover.includes('mmbiz.qpic.cn') ? '微信素材' : 'URL失效';
    console.log(`  ${i+1}. id=${r.id} ${r.title} [${reason}]`);
  });
  console.log();

  // 调 fillCoversForRecipes 补封面
  const result = await fillCoversForRecipes(needFill, { dryRun, delayMs: 1500 });

  console.log('\n═══════════════════════════════════════');
  console.log('📋 结果汇总');
  console.log('═══════════════════════════════════════');
  console.log(`✅ 成功: ${result.success}`);
  console.log(`❌ 失败: ${result.failed}`);

  if (result.failedTitles.length > 0) {
    console.log(`\n未找到图片的菜谱:`);
    result.failedTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  }
}

main().catch(err => {
  console.error('❌ 执行出错:', err.message);
  process.exit(1);
});
