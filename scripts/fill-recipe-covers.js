#!/usr/bin/env node
/**
 * 菜谱封面图批量补充工具
 * 
 * 策略：Pixabay 搜索 → 智能降级（别名/食材/英文关键词）→ 直连数据库更新
 * 
 * 用法:
 *   node scripts/fill-recipe-covers.js
 *   node scripts/fill-recipe-covers.js --dry-run    # 只搜索不更新
 *   node scripts/fill-recipe-covers.js --limit=20   # 只处理前20条
 * 
 * 环境变量:
 *   PIXABAY_API_KEY  - Pixabay API Key
 */

const { Op } = require('sequelize');
const { sequelize } = require('../db');
const Recipe = require('../models/Recipe');

// ========== 配置 ==========
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY || '';
const https = require('https');

// 解析命令行参数
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]) || 50;
const delayMs = 1000; // API 调用间隔

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ========== 搜索关键词映射 ==========
// 中文别名 → 更通用的搜索词
const ALIAS_MAP = {
  '西红柿炒鸡蛋': '番茄炒蛋',
  '西红柿鸡蛋': '番茄炒蛋',
  '西红柿蛋汤': '番茄蛋花汤',
  '土豆丝': '酸辣土豆丝',
  '可乐鸡翅': '可乐鸡翅 chicken wings',
  '糖醋里脊': '糖醋肉',
};

// 英文翻译（针对中国特色菜）
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

  // 1. 别名映射
  if (ALIAS_MAP[title]) {
    keywords.push({ kw: ALIAS_MAP[title], label: `别名: ${ALIAS_MAP[title]}` });
  }

  // 2. 原标题
  keywords.push({ kw: title, label: `原标题: ${title}` });

  // 3. 英文翻译
  if (EN_MAP[title]) {
    keywords.push({ kw: EN_MAP[title], label: `英文: ${EN_MAP[title]}` });
  }

  // 4. 提取主要食材
  const ingredients = extractMainIngredient(title);
  if (ingredients && ingredients !== title) {
    keywords.push({ kw: ingredients, label: `食材: ${ingredients}` });
  }

  // 5. 去"做法"前缀（红烧/清蒸/凉拌等）
  const baseFood = stripCookingMethod(title);
  if (baseFood && baseFood.length >= 2) {
    keywords.push({ kw: baseFood, label: `去前缀: ${baseFood}` });
  }

  return keywords;
}

function extractMainIngredient(title) {
  const patterns = [
    /(?:红烧|清蒸|凉拌|蒜蓉|糖醋|酸辣|水煮|干锅|黄焖|葱油|白灼|酱爆|爆炒|油炸|烤)(.*)/,
    /(.*)肉$/,
    /(.*)鱼$/,
    /(.*)鸡$/,
    /(.*)虾$/,
    /(.*)排骨$/,
    /(.*)牛肉$/,
    /(.*)羊肉$/,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1] && match[1].length >= 1) {
      return match[1];
    }
  }
  return null;
}

function stripCookingMethod(title) {
  return title.replace(/^(红烧|清蒸|凉拌|蒜蓉|糖醋|酸辣|水煮|干锅|黄焖|葱油|白灼|酱爆|爆炒|油炸|烤)/, '');
}

// ========== Pixabay 图片搜索 ==========
async function searchPixabay(query) {
  if (!PIXABAY_API_KEY) return null;

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
            // 用 webformatURL（960px），适合小程序
            resolve({
              url: hit.webformatURL,
              source: 'Pixabay',
              photographer: hit.user,
            });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// 智能搜索：逐级降级
async function findCoverImage(title) {
  const keywords = generateKeywords(title);

  for (const { kw, label } of keywords) {
    console.log(`    🔍 ${label}`);

    const result = await searchPixabay(kw);
    if (result) return result;
    await sleep(300); // API 间隔
  }

  return null;
}

// ========== 主函数 ==========
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  味口小程序 - 菜谱封面图批量补充工具');
  console.log('═══════════════════════════════════════\n');

  // 检查 API Key
  if (!PIXABAY_API_KEY) {
    console.log('❌ 未设置 PIXABAY_API_KEY 环境变量');
    console.log('   export PIXABAY_API_KEY="你的Key"');
    process.exit(1);
  }
  console.log(`✅ Pixabay API Key: 已设置`);

  console.log(`🔧 模式: ${dryRun ? '试运行（只搜索不更新）' : '正式模式（会更新数据库）'}`);
  console.log(`📊 批次大小: ${limit}\n`);

  // 连接数据库
  await sequelize.authenticate();
  console.log('✅ 数据库连接成功\n');

  // 查询无封面的菜谱
  const noCoverRecipes = await Recipe.findAll({
    where: {
      [Op.or]: [
        { cover: null },
        { cover: '' },
      ],
    },
    order: [['created_at', 'ASC']],
    limit,
  });

  console.log(`🎯 本次处理: ${noCoverRecipes.length} 道\n`);

  if (noCoverRecipes.length === 0) {
    console.log('✅ 所有菜谱已有封面，无需处理！');
    process.exit(0);
  }

  // 统计
  let success = 0;
  let failed = 0;
  const failedTitles = [];

  for (let i = 0; i < noCoverRecipes.length; i++) {
    const recipe = noCoverRecipes[i];
    console.log(`[${i + 1}/${noCoverRecipes.length}] ${recipe.title}`);

    const result = await findCoverImage(recipe.title);

    if (result) {
      console.log(`    ✅ ${result.source} | 摄影师: ${result.photographer}`);
      console.log(`    🖼️  ${result.url.slice(0, 80)}...`);

      if (!dryRun) {
        await recipe.update({ cover: result.url });
        console.log(`    💾 已更新数据库`);
        success++;
      } else {
        success++;
      }
    } else {
      console.log(`    ❌ 未找到合适图片`);
      failed++;
      failedTitles.push(recipe.title);
    }

    console.log('');

    // API 速率限制
    if (i < noCoverRecipes.length - 1) {
      await sleep(delayMs);
    }
  }

  // 汇总
  console.log('═══════════════════════════════════════');
  console.log('📋 本次结果汇总');
  console.log('═══════════════════════════════════════');
  console.log(`✅ 成功匹配: ${success}`);
  console.log(`❌ 未找到:   ${failed}`);

  if (failedTitles.length > 0) {
    console.log(`\n未找到图片的菜谱（${failedTitles.length}道）:`);
    failedTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    console.log('\n💡 建议: 对这些菜谱使用 AI 生成（通义万相）或手动添加');
  }

  // 统计剩余
  const remainingTotal = await Recipe.count({
    where: { [Op.or]: [{ cover: null }, { cover: '' }] },
  });
  if (remainingTotal > 0) {
    console.log(`\n⚠️  还有 ${remainingTotal} 道无封面，可再次运行:`);
    console.log(`   node scripts/fill-recipe-covers.js --limit=${Math.min(50, remainingTotal)}`);
  } else {
    console.log('\n🎉 全部处理完成！');
  }

  if (dryRun) {
    console.log('\n⚠️  这是试运行模式，未写入数据库');
    console.log('   确认效果后，去掉 --dry-run 参数正式运行');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('❌ 执行出错:', err.message);
  process.exit(1);
});
