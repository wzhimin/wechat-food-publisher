#!/usr/bin/env node
/**
 * 菜谱封面图批量补充工具
 * 
 * 策略：Pixabay 搜索 → 智能降级（别名/食材/英文关键词）
 * 通过云端 HTTP API 更新数据库
 * 
 * 用法:
 *   node scripts/fill-recipe-covers.js
 *   node scripts/fill-recipe-covers.js --dry-run    # 只搜索不更新
 *   node scripts/fill-recipe-covers.js --limit=20   # 只处理前20条
 * 
 * 也可作为模块导入：
 *   const { fillCoversForRecipes } = require('./scripts/fill-recipe-covers');
 *   await fillCoversForRecipes([{ id: 1, title: '红烧肉' }]);
 */

const https = require('https');

// ========== 配置 ==========
const PIXABAY_API_KEY = '55448016-5bb57529981c9058bfeb1153c';
const API_BASE = process.env.API_BASE || 'https://express-yi42-246142-8-1421971309.sh.run.tcloudbase.com';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ========== HTTP 工具 ==========
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

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, API_BASE);
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ========== 搜索关键词映射 ==========
const ALIAS_MAP = {
  '西红柿炒鸡蛋': '番茄炒蛋',
  '西红柿鸡蛋': '番茄炒蛋',
  '西红柿蛋汤': '番茄蛋花汤',
  '土豆丝': '酸辣土豆丝',
  '可乐鸡翅': '可乐鸡翅 chicken wings',
  '糖醋里脊': '糖醋肉',
};

const EN_MAP = {
  '红烧肉': 'braised pork belly chinese food',
  '宫保鸡丁': 'kung pao chicken',
  '麻婆豆腐': 'mapo tofu',
  '糖醋排骨': 'sweet and sour pork ribs',
  '清蒸鱼': 'steamed fish chinese',
  '蛋炒饭': 'egg fried rice',
  '红烧排骨': 'braised pork ribs',
  '回锅肉': 'twice cooked pork',
  '水煮鱼': 'boiled fish chili',
  '酸菜鱼': 'pickled cabbage fish',
  '可乐鸡翅': 'cola chicken wings',
  '鱼香肉丝': 'shredded pork garlic sauce',
  '辣子鸡': 'spicy diced chicken',
  '锅包肉': 'crispy pork northeast china',
  '红烧茄子': 'braised eggplant',
  '蒜蓉西兰花': 'garlic broccoli',
  '凉拌黄瓜': 'cucumber salad chinese',
  '番茄蛋花汤': 'tomato egg drop soup',
  '紫菜蛋花汤': 'seaweed egg drop soup',
  '酸辣汤': 'hot and sour soup',
  '排骨汤': 'pork rib soup',
  '鸡汤': 'chicken soup',
  '冬瓜排骨汤': 'winter melon pork rib soup',
  '萝卜排骨汤': 'radish pork rib soup',
};

// ========== 智能关键词生成 ==========
function generateKeywords(title) {
  const keywords = [];
  if (ALIAS_MAP[title]) {
    keywords.push({ kw: ALIAS_MAP[title], label: `别名: ${ALIAS_MAP[title]}` });
  }
  keywords.push({ kw: title, label: `原标题: ${title}` });
  if (EN_MAP[title]) {
    keywords.push({ kw: EN_MAP[title], label: `英文: ${EN_MAP[title]}` });
  }
  const ingredients = extractMainIngredient(title);
  if (ingredients && ingredients !== title) {
    keywords.push({ kw: ingredients, label: `食材: ${ingredients}` });
  }
  const baseFood = stripCookingMethod(title);
  if (baseFood && baseFood.length >= 2) {
    keywords.push({ kw: baseFood, label: `去前缀: ${baseFood}` });
  }
  return keywords;
}

function extractMainIngredient(title) {
  const patterns = [
    /(?:红烧|清蒸|凉拌|蒜蓉|糖醋|酸辣|水煮|干锅|黄焖|葱油|白灼|酱爆|爆炒|油炸|烤)(.*)/,
    /(.*)肉$/, /(.*)鱼$/, /(.*)鸡$/, /(.*)虾$/,
    /(.*)排骨$/, /(.*)牛肉$/, /(.*)羊肉$/,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1] && match[1].length >= 1) return match[1];
  }
  return null;
}

function stripCookingMethod(title) {
  return title.replace(/^(红烧|清蒸|凉拌|蒜蓉|糖醋|酸辣|水煮|干锅|黄焖|葱油|白灼|酱爆|爆炒|油炸|烤)/, '');
}

// ========== Pixabay 图片搜索 ==========
async function searchPixabay(query) {
  const url = `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&per_page=5&safesearch=true`;
  return new Promise((resolve) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.hits && json.hits.length > 0) {
            const hit = json.hits[0];
            resolve({ url: hit.webformatURL, source: 'Pixabay', photographer: hit.user });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// 智能搜索：逐级降级
async function findCoverImage(title) {
  const keywords = generateKeywords(title);
  for (const { kw, label } of keywords) {
    const result = await searchPixabay(kw);
    if (result) {
      console.log(`    🖼️  ${label} → 找到`);
      return result;
    }
    await sleep(300);
  }
  return null;
}

// ========== 核心函数（可导出） ==========
/**
 * 为指定菜谱列表补全封面
 * @param {Array} recipes - 菜谱列表，每项需包含 { id, title, cover? }
 * @param {Object} options - { dryRun?: boolean, delayMs?: number }
 * @returns {Object} { success: number, failed: number, failedTitles: string[] }
 */
async function fillCoversForRecipes(recipes, options = {}) {
  const { dryRun = false, delayMs = 1200 } = options;
  
  if (!recipes || recipes.length === 0) {
    return { success: 0, failed: 0, failedTitles: [] };
  }

  // 只处理无封面的
  const noCover = recipes.filter(r => !r.cover || r.cover === '');
  if (noCover.length === 0) {
    console.log('[补封面] 所有菜谱已有封面');
    return { success: 0, failed: 0, failedTitles: [] };
  }

  console.log(`[补封面] 开始处理 ${noCover.length} 道无封面菜谱`);
  
  let success = 0, failed = 0;
  const failedTitles = [];

  for (let i = 0; i < noCover.length; i++) {
    const recipe = noCover[i];
    console.log(`[补封面] [${i + 1}/${noCover.length}] ${recipe.title}`);

    const result = await findCoverImage(recipe.title);

    if (result) {
      console.log(`[补封面]     ✅ ${result.url.slice(0, 60)}...`);

      if (!dryRun) {
        try {
          const updateRes = await httpPost('/api/admin/update-cover', {
            id: recipe.id,
            cover: result.url,
          });
          if (updateRes.success) {
            success++;
          } else {
            console.log(`[补封面]     ❌ 更新失败: ${updateRes.error}`);
            failed++;
            failedTitles.push(recipe.title);
          }
        } catch (e) {
          console.log(`[补封面]     ❌ 请求失败: ${e.message}`);
          failed++;
          failedTitles.push(recipe.title);
        }
      } else {
        success++;
      }
    } else {
      console.log(`[补封面]     ❌ 未找到图片`);
      failed++;
      failedTitles.push(recipe.title);
    }

    if (i < noCover.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log(`[补封面] 完成: 成功 ${success}, 失败 ${failed}`);
  return { success, failed, failedTitles };
}

// ========== CLI 入口 ==========
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  味口小程序 - 菜谱封面图批量补充工具');
  console.log('═══════════════════════════════════════\n');

  // 解析命令行参数
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]) || 50;

  console.log(`✅ Pixabay API Key: 已配置`);
  console.log(`📡 后端地址: ${API_BASE}`);
  console.log(`🔧 模式: ${dryRun ? '试运行' : '正式模式'}`);
  console.log(`📊 批次大小: ${limit}\n`);

  // 拉取菜谱列表
  console.log('📦 拉取菜谱数据...');
  const res = await httpGet('/api/recipe/list?page=1&pageSize=200');
  if (!res.success) {
    console.error('❌ 拉取失败:', res);
    process.exit(1);
  }

  const allRecipes = res.data;
  console.log(`📊 总共 ${res.total} 道菜谱\n`);

  const batch = allRecipes.filter(r => !r.cover || r.cover === '').slice(0, limit);
  console.log(`📭 无封面: ${batch.length} 道（本次处理）\n`);

  if (batch.length === 0) {
    console.log('✅ 所有菜谱已有封面！');
    process.exit(0);
  }

  const result = await fillCoversForRecipes(batch, { dryRun, delayMs: 1200 });

  console.log('\n═══════════════════════════════════════');
  console.log('📋 结果汇总');
  console.log('═══════════════════════════════════════');
  console.log(`✅ 成功: ${result.success}`);
  console.log(`❌ 失败: ${result.failed}`);

  if (result.failedTitles.length > 0) {
    console.log(`\n未找到图片的菜谱:`);
    result.failedTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    console.log('\n💡 建议: AI 生成或手动添加');
  }

  if (dryRun) {
    console.log('\n⚠️  试运行模式，未写入数据库');
  }
}

// 导出函数供其他模块调用
module.exports = { fillCoversForRecipes, findCoverImage };

// 如果直接运行脚本
if (require.main === module) {
  main().catch(err => {
    console.error('❌ 执行出错:', err.message);
    process.exit(1);
  });
}
