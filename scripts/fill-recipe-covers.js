#!/usr/bin/env node
/**
 * 菜谱封面图批量补充工具 V2
 * 
 * 策略：通义万相 AI 生成 → Pixabay 搜索 → 智能降级（别名/食材/英文关键词）
 * 通过云端 HTTP API 更新数据库
 * 
 * 用法:
 *   node scripts/fill-recipe-covers.js
 *   node scripts/fill-recipe-covers.js --dry-run    # 只搜索不更新
 *   node scripts/fill-recipe-covers.js --limit=20   # 只处理前20条
 *   node scripts/fill-recipe-covers.js --no-ai      # 跳过AI生成，只用Pixabay
 * 
 * 也可作为模块导入：
 *   const { fillCoversForRecipes } = require('./scripts/fill-recipe-covers');
 *   await fillCoversForRecipes([{ id: 1, title: '红烧肉' }]);
 */

const https = require('https');
const http = require('http');

// ========== 配置 ==========
const PIXABAY_API_KEY = '55448016-5bb57529981c9058bfeb1153c';
const DASHSCOPE_API_KEY = 'sk-e008ef57b56c449ba413e954c4a63edd'; // 通义万相（百炼平台）
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

// ========== 图片下载（buffer） ==========
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadImage(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('下载超时')); });
  });
}

// ========== 上传图片到微信永久素材 ==========
async function uploadImageToWeChat(buffer) {
  const b64 = buffer.toString('base64');
  const data = JSON.stringify({ imageBase64: b64 });
  const url = new URL('/api/upload-image', API_BASE);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.success && json.url) resolve(json.url);
          else reject(new Error(json.error || '上传失败'));
        } catch (e) { reject(new Error(body)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ========== 通义万相 AI 图片生成 ==========
async function generateWithWanxiang(title) {
  const prompt = `一张高清美食照片，${title}，家常中餐，色泽鲜亮，热气腾腾，自然光，写实风格，细节丰富`;
  
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'wanx-v1',
      input: { prompt },
      parameters: { n: 1, size: '1024*1024' }
    });
    
    const opts = {
      hostname: 'dashscope.aliyuncs.com',
      path: '/api/v1/services/aigc/text2image/image-synthesis',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable'
      }
    };
    
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);
          const taskId = json.output?.task_id;
          if (!taskId) {
            console.log(`[AI生成] 提交失败: ${JSON.stringify(json)}`);
            resolve(null);
            return;
          }
          
          // 轮询结果
          const imageUrl = await pollWanxiangTask(taskId);
          if (imageUrl) {
            resolve({ url: imageUrl, source: '通义万相', photographer: 'AI生成' });
          } else {
            resolve(null);
          }
        } catch (e) {
          console.log(`[AI生成] 解析失败: ${e.message}`);
          resolve(null);
        }
      });
    });
    
    req.on('error', (e) => {
      console.log(`[AI生成] 请求失败: ${e.message}`);
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

async function pollWanxiangTask(taskId, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    await sleep(3000);
    
    const result = await new Promise((resolve) => {
      const opts = {
        hostname: 'dashscope.aliyuncs.com',
        path: `/api/v1/tasks/${taskId}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
        }
      };
      
      const req = https.request(opts, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    });
    
    if (!result) continue;
    
    const status = result.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = result.output?.results?.[0]?.url;
      if (url) {
        // 下载图片并转为 base64 或直接返回 URL
        return url; // 先返回 URL，后续可考虑下载到自己的存储
      }
    } else if (status === 'FAILED') {
      console.log(`[AI生成] 任务失败: ${result.output?.message}`);
      return null;
    }
  }
  
  console.log(`[AI生成] 超时`);
  return null;
}

// ========== 搜索关键词映射 ==========
const ALIAS_MAP = {
  // 常见别名
  '西红柿炒鸡蛋': '番茄炒蛋',
  '西红柿鸡蛋': '番茄炒蛋',
  '西红柿蛋汤': '番茄蛋花汤',
  '土豆丝': '酸辣土豆丝',
  '可乐鸡翅': '可乐鸡翅 chicken wings',
  '糖醋里脊': '糖醋肉',
  
  // 食材别名
  '蒜苔': '蒜薹',
  '蒜台': '蒜薹',
  '苔菜': '蒜薹',
  '扁豆': '四季豆',
  '芸豆': '四季豆',
  '荷兰豆': '四季豆',
  '土腥豆': '四季豆',
  '土豆': '马铃薯',
  '洋芋': '马铃薯',
  '地蛋': '马铃薯',
  '西红柿': '番茄',
  '洋柿子': '番茄',
  '小番茄': '番茄',
  '黄瓜': '青瓜',
  '青瓜': '黄瓜',
  '长豆角': '豇豆',
  '豆角': '豇豆',
  '四季豆': '芸豆',
  '菜心': '菜薹',
  '菜薹': '油菜薹',
  '西兰花': '花椰菜',
  '花菜': '花椰菜',
  '包菜': '卷心菜',
  '大头菜': '卷心菜',
  '白菜': '大白菜',
  '小白菜': '油菜',
  '空心菜': '蕹菜',
  '茼蒿': '蒿子杆',
  '萝卜': '白萝卜',
  '青萝卜': '沙窝萝卜',
  '胡萝卜': '红萝卜',
  '山药': '淮山',
  '毛豆': '黄豆',
  '黄豆': '大豆',
  '黑豆': '黑大豆',
  '红豆': '赤小豆',
  '绿豆': '绿豆',
  '荷兰豆炒腊肉': '四季豆炒腊肉',
  '扁豆炒肉丝': '四季豆炒肉丝',
  
  // 烹饪方法+食材的简化
  '红烧肉': '红烧肉五花肉',
  '红烧排骨': '红烧排骨',
  '红烧鸡翅': '红烧鸡翅',
  '红烧鱼': '红烧鱼',
  '清蒸鲈鱼': '清蒸鱼',
  '清蒸武昌鱼': '清蒸鱼',
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
  '蒜薹': 'garlic scapes chinese',
  '蒜苔': 'garlic scapes',
  '四季豆': 'green beans chinese',
  '番茄': 'tomato chinese',
  '土豆': 'potato chinese',
  '黄瓜': 'cucumber chinese',
  '西兰花': 'broccoli chinese',
  '胡萝卜': 'carrot chinese',
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

// 智能搜索：AI生成 → Pixabay逐级降级
// 通用的"下载→上传微信"步骤，AI/Pixabay 共用
async function downloadAndUpload(imageUrl) {
  try {
    const buffer = await downloadImage(imageUrl);
    const wechatUrl = await uploadImageToWeChat(buffer);
    console.log(`    ☁️ 已上传微信素材: ${wechatUrl.slice(0, 50)}...`);
    return wechatUrl;
  } catch (e) {
    // 上传失败，保留原链接（降级兜底）
    console.log(`    ⚠️ 上传微信失败（${e.message}），保留原链接`);
    return imageUrl;
  }
}

async function findCoverImage(title, useAI = true) {
  // 1. 通义万相 AI 生成
  if (useAI) {
    console.log(`    🤖 尝试 AI 生成...`);
    const aiResult = await generateWithWanxiang(title);
    if (aiResult) {
      console.log(`    ✅ AI 生成成功，下载并上传到微信永久素材...`);
      const finalUrl = await downloadAndUpload(aiResult.url);
      return { url: finalUrl, source: '通义万相→微信', photographer: 'AI生成' };
    }
    console.log(`    ⚠️  AI 生成失败，降级到 Pixabay`);
  }

  // 2. Pixabay 搜索
  const keywords = generateKeywords(title);
  for (const { kw, label } of keywords) {
    const result = await searchPixabay(kw);
    if (result) {
      console.log(`    🖼️  ${label} → 找到，下载并上传到微信永久素材...`);
      const finalUrl = await downloadAndUpload(result.url);
      return { url: finalUrl, source: 'Pixabay→微信', photographer: result.photographer || '' };
    }
    await sleep(300);
  }
  return null;
}

// ========== 核心函数（可导出） ==========
/**
 * 为指定菜谱列表补全封面
 * @param {Array} recipes - 菜谱列表，每项需包含 { id, title, cover? }
 * @param {Object} options - { dryRun?: boolean, delayMs?: number, useAI?: boolean }
 * @returns {Object} { success: number, failed: number, failedTitles: string[] }
 */
async function fillCoversForRecipes(recipes, options = {}) {
  const { dryRun = false, delayMs = 1200, useAI = true } = options;
  
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
  console.log(`[补封面] 图片来源: ${useAI ? '通义万相 AI → Pixabay' : 'Pixabay'}`);
  
  let success = 0, failed = 0;
  const failedTitles = [];

  for (let i = 0; i < noCover.length; i++) {
    const recipe = noCover[i];
    console.log(`[补封面] [${i + 1}/${noCover.length}] ${recipe.title}`);

    const result = await findCoverImage(recipe.title, useAI);

    if (result) {
      console.log(`[补封面]     ✅ ${result.source}: ${result.url.slice(0, 50)}...`);

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
  console.log('  味口小程序 - 菜谱封面图批量补充工具 V2');
  console.log('═══════════════════════════════════════\n');

  // 解析命令行参数
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noAI = args.includes('--no-ai');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]) || 50;

  console.log(`✅ Pixabay API Key: 已配置`);
  console.log(`✅ 通义万相 API Key: ${DASHSCOPE_API_KEY.slice(0, 10)}...`);
  console.log(`📡 后端地址: ${API_BASE}`);
  console.log(`🔧 模式: ${dryRun ? '试运行' : '正式模式'}`);
  console.log(`🤖 AI生成: ${noAI ? '关闭' : '开启'}`);
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

  const result = await fillCoversForRecipes(batch, { dryRun, delayMs: 1500, useAI: !noAI });

  console.log('\n═══════════════════════════════════════');
  console.log('📋 结果汇总');
  console.log('═══════════════════════════════════════');
  console.log(`✅ 成功: ${result.success}`);
  console.log(`❌ 失败: ${result.failed}`);

  if (result.failedTitles.length > 0) {
    console.log(`\n未找到图片的菜谱:`);
    result.failedTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    console.log('\n💡 建议: 手动添加封面图');
  }

  if (dryRun) {
    console.log('\n⚠️  试运行模式，未写入数据库');
  }
}

// 导出函数供其他模块调用
module.exports = { fillCoversForRecipes, findCoverImage, generateWithWanxiang };

// 如果直接运行脚本
if (require.main === module) {
  main().catch(err => {
    console.error('❌ 执行出错:', err.message);
    process.exit(1);
  });
}
