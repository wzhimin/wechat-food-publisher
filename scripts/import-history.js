#!/usr/bin/env node
/**
 * 历史文章批量解析入库
 * 运行一次即可，将 ~/Downloads/公众号文章/ 下的所有 .md 文章解析入库
 *
 * 用法: node scripts/import-history.js
 */

const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

// 读取环境变量
const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = '' } = process.env;
const [host, port] = MYSQL_ADDRESS.split(':');

const sequelize = new Sequelize('nodejs_demo', MYSQL_USERNAME, MYSQL_PASSWORD, {
  host,
  port,
  dialect: 'mysql',
  logging: false,
});

// ========== 复制 recipe.js 的解析逻辑 ==========
function parseMarkdownRecipes(markdown, meta = {}) {
  const recipes = [];
  const sections = markdown.split(/\n(?=##\s)/);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    if (!lines.length) continue;

    const titleLine = lines[0];
    const titleMatch = titleLine.match(/##\s+(?:💕\s+)?(?:\d+\.\s+)?(.+)/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();
    if (!title || title.length < 2) continue;

    const ingredientsMatch = section.match(/\*\*食材[：:]\*\*\s*(.+)/);
    let ingredients = [];
    if (ingredientsMatch) {
      ingredients = ingredientsMatch[1]
        .split(/[、，,]/)
        .map(s => s.trim())
        .filter(Boolean);
    }

    const stepsMatch = section.match(/\*\*做法[：:]\*\*([\s\S]*?)(?=💡|##|$)/);
    let steps = [];
    if (stepsMatch) {
      steps = stepsMatch[1]
        .split('\n')
        .map(s => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
    }

    const tipsMatch = section.match(/💡\s*小贴士[：:]?\s*(.+)/);
    const tips = tipsMatch ? tipsMatch[1].trim() : '';
    const tags = inferTags(title, ingredients, section);
    const season = inferSeason(section);

    recipes.push({
      title,
      cover: meta.cover || null,
      difficulty: inferDifficulty(steps),
      duration: inferDuration(steps),
      tags: tags.join(','),
      season,
      ingredients: JSON.stringify(ingredients),
      steps: JSON.stringify(steps),
      tips,
      articleId: meta.articleId || null,
      publishedAt: meta.publishedAt || new Date(),
    });
  }

  return recipes;
}

function inferTags(title, ingredients, text) {
  const tags = [];
  const t = title + text;
  if (/下饭|米饭杀手|下酒/.test(t)) tags.push('下饭菜');
  if (/家常|简单|快手|懒人/.test(t)) tags.push('家常菜');
  if (/减脂|低卡|清淡|素/.test(t)) tags.push('减脂餐');
  if (/早餐|早饭/.test(t)) tags.push('早餐');
  if (/汤|羹|炖/.test(t)) tags.push('汤羹');
  if (/甜|糕|饼|点心/.test(t)) tags.push('甜点');
  if (/猪|牛|羊|鸡|鸭|鱼|虾|蟹/.test(t)) tags.push('肉菜');
  if (tags.length === 0) tags.push('家常菜');
  return tags;
}

function inferSeason(text) {
  const seasons = [];
  if (/春|清明|谷雨|春笋|香椿|荠菜/.test(text)) seasons.push('春季');
  if (/夏|立夏|苦瓜|冬瓜|绿豆/.test(text)) seasons.push('夏季');
  if (/秋|立秋|螃蟹|板栗|南瓜/.test(text)) seasons.push('秋季');
  if (/冬|立冬|羊肉|萝卜|白菜/.test(text)) seasons.push('冬季');
  return seasons.join(',');
}

function inferDifficulty(steps) {
  if (steps.length <= 3) return 1;
  if (steps.length <= 6) return 2;
  return 3;
}

function inferDuration(steps) {
  if (steps.length <= 3) return '15分钟';
  if (steps.length <= 5) return '30分钟';
  return '45分钟';
}

// ========== 主逻辑 ==========
async function main() {
  const articlesDir = path.join(process.env.HOME, 'Downloads', '公众号文章');

  const files = fs.readdirSync(articlesDir)
    .filter(f => f.endsWith('.md') && !f.includes('_cover'))
    .sort();

  if (files.length === 0) {
    console.log('没有找到 .md 文件');
    return;
  }

  await sequelize.authenticate();
  console.log(`找到 ${files.length} 篇文章，开始解析...\n`);

  let totalRecipes = 0;
  let totalSkipped = 0;

  for (const file of files) {
    const filePath = path.join(articlesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const coverPath = file.replace('.md', '_cover.jpg');
    const coverFullPath = path.join(articlesDir, coverPath);
    const cover = fs.existsSync(coverFullPath) ? coverFullPath : null;

    // 从文件名提取日期
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_/);
    const publishedAt = dateMatch ? new Date(dateMatch[1]) : new Date();

    const recipes = parseMarkdownRecipes(content, {
      cover: cover ? `file://${cover}` : null,
      articleId: `imported_${file}`,
      publishedAt,
    });

    console.log(`[${file}] 解析到 ${recipes.length} 道菜`);
    totalRecipes += recipes.length;
    totalSkipped += 8 - recipes.length; // 预期8道
  }

  // 实际入库
  const Recipe = sequelize.define('Recipe', {
    title: { type: Sequelize.DataTypes.STRING(128), allowNull: false },
    cover: { type: Sequelize.DataTypes.STRING(512) },
    difficulty: { type: Sequelize.DataTypes.TINYINT, defaultValue: 2 },
    duration: { type: Sequelize.DataTypes.STRING(32) },
    tags: { type: Sequelize.DataTypes.STRING(256) },
    season: { type: Sequelize.DataTypes.STRING(64) },
    ingredients: { type: Sequelize.DataTypes.TEXT },
    steps: { type: Sequelize.DataTypes.TEXT },
    tips: { type: Sequelize.DataTypes.TEXT },
    articleId: { type: Sequelize.DataTypes.STRING(64) },
    publishedAt: { type: Sequelize.DataTypes.DATE },
  }, { tableName: 'recipes', timestamps: true });

  await Recipe.sync({ alter: true });

  let inserted = 0;
  for (const file of files) {
    const filePath = path.join(articlesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_/);
    const publishedAt = dateMatch ? new Date(dateMatch[1]) : new Date();

    const recipes = parseMarkdownRecipes(content, {
      articleId: `imported_${file}`,
      publishedAt,
    });

    for (const recipe of recipes) {
      try {
        await Recipe.findOrCreate({
          where: { title: recipe.title, articleId: recipe.articleId },
          defaults: recipe,
        });
        inserted++;
      } catch (e) {
        // 忽略
      }
    }
  }

  console.log(`\n入库完成：${inserted} 道菜已写入数据库`);
  await sequelize.close();
}

main().catch(err => {
  console.error('导入失败:', err.message);
  process.exit(1);
});
