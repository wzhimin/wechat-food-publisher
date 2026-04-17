const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const Recipe = require('../models/Recipe');
const User = require('../models/User');

// GET /api/recipe/list
// 查询菜谱列表，支持搜索、分类、时令筛选、排序
// ?kw=红烧肉  按菜名/食材搜索
// ?tag=下饭菜  按标签筛选
// ?season=春季  按时令筛选
// ?sort=latest|hot|duration  排序方式（最新/最热/最短时间）
// ?page=1&pageSize=20
router.get('/list', async (req, res) => {
  try {
    const { kw, tag, season, sort = 'latest', page = 1, pageSize = 20 } = req.query;
    const where = {};

    if (kw) {
      where[Op.or] = [
        { title: { [Op.like]: `%${kw}%` } },
        { ingredients: { [Op.like]: `%${kw}%` } },
        { tags: { [Op.like]: `%${kw}%` } },
      ];
    }
    if (tag) {
      where.tags = { [Op.like]: `%${tag}%` };
    }
    if (season) {
      where.season = { [Op.like]: `%${season}%` };
    }

    // 排序
    let order;
    switch (sort) {
      case 'hot':
        order = [['likeCount', 'DESC'], ['created_at', 'DESC']];
        break;
      case 'duration':
        order = [['duration', 'ASC'], ['created_at', 'DESC']];
        break;
      case 'latest':
      default:
        order = [['created_at', 'DESC']];
    }

    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const { count, rows } = await Recipe.findAndCountAll({
      where,
      order,
      limit: parseInt(pageSize),
      offset,
    });

    res.json({
      success: true,
      data: rows,
      total: count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (err) {
    console.error('[/api/recipe/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recipe/hot
// 今日推荐：从最近30条里随机取5条供轮播
router.get('/hot', async (req, res) => {
  try {
    const total = await Recipe.count();
    if (total === 0) return res.json({ success: true, data: [] });

    const recent = await Recipe.findAll({
      order: [['created_at', 'DESC']],
      limit: 30,
    });
    // 随机打乱，取前5条
    const shuffled = recent.sort(() => Math.random() - 0.5).slice(0, 5);
    res.json({ success: true, data: shuffled });
  } catch (err) {
    console.error('[/api/recipe/hot]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recipe/random
// 随机推荐一道菜（吃啥页用）
router.get('/random', async (req, res) => {
  try {
    const { exclude } = req.query; // 排除某个id，避免连续推同一道
    const where = {};
    if (exclude) where.id = { [Op.ne]: parseInt(exclude) };

    const total = await Recipe.count({ where });
    if (total === 0) return res.json({ success: true, data: null });

    const offset = Math.floor(Math.random() * total);
    const recipe = await Recipe.findOne({ where, offset });
    res.json({ success: true, data: recipe });
  } catch (err) {
    console.error('[/api/recipe/random]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recipe/detail/:id 或 /api/recipe/detail?id=xxx
async function getDetail(req, res) {
  try {
    const id = req.params.id || req.query.id;
    if (!id) return res.status(400).json({ error: '缺少 id' });
    const recipe = await Recipe.findByPk(id);
    if (!recipe) return res.status(404).json({ error: '菜谱不存在' });
    res.json({ success: true, data: recipe });
  } catch (err) {
    console.error('[/api/recipe/detail]', err.message);
    res.status(500).json({ error: err.message });
  }
}
router.get('/detail', getDetail);      // ?id=xxx
router.get('/detail/:id', getDetail);  // /detail/xxx

// POST /api/recipe/delete
// 删除菜谱（管理员用）
// Body: { id }
router.post('/delete', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: '缺少 id' });
    const recipe = await Recipe.findByPk(id);
    if (!recipe) return res.status(404).json({ error: '菜谱不存在' });
    await recipe.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/recipe/delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recipe/parse
// 解析 markdown 文本，批量入库菜谱
// Body: { markdown, cover?, articleId?, publishedAt? }
router.post('/parse', async (req, res) => {
  try {
    const { markdown, cover, articleId, publishedAt } = req.body;
    if (!markdown) return res.status(400).json({ error: '缺少 markdown' });

    const recipes = parseMarkdownRecipes(markdown, { cover, articleId, publishedAt });
    if (recipes.length === 0) return res.status(400).json({ error: '未解析到菜谱，请检查 markdown 格式' });

    const created = await Recipe.bulkCreate(recipes, { ignoreDuplicates: true });
    res.json({ success: true, count: created.length, data: created });
  } catch (err) {
    console.error('[/api/recipe/parse]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recipe/add
// 小程序内发布菜谱
// Body: { title, cover, ingredients, steps, duration, difficulty, tags, tips }
router.post('/add', async (req, res) => {
  try {
    const openid = req.body.openid || req.query.openid;
    const { title, cover, ingredients, steps, duration, difficulty, tags, tips } = req.body;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });
    if (!title || !title.trim()) return res.status(400).json({ error: '请输入菜谱名称' });

    // 检查用户存在
    let user = await User.findOne({ where: { openid } });
    if (!user) {
      // 自动创建用户
      user = await User.create({ openid, nickName: '新用户', avatarUrl: '' });
    }

    const recipe = await Recipe.create({
      title: title.trim(),
      cover: cover || '',
      ingredients: typeof ingredients === 'string' ? ingredients : JSON.stringify(ingredients || []),
      steps: typeof steps === 'string' ? steps : JSON.stringify(steps || []),
      duration: duration || '30分钟',
      difficulty: Number(difficulty) || 1,
      tags: tags || '',
      tips: tips || '',
      authorOpenid: openid,
      likeCount: 0,
      commentCount: 0,
    });

    res.json({ success: true, data: recipe });
  } catch (err) {
    console.error('[/api/recipe/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 解析 markdown 工具函数 ==========
// 支持格式：
// ## 💕 1. 菜名
// **食材：** 食材1、食材2...
// **做法：**
// 1. 步骤1
// 2. 步骤2
// 💡 小贴士：...
function parseMarkdownRecipes(markdown, meta = {}) {
  const recipes = [];

  // 按 "## 💕" 或 "## 1." 等章节分割
  const sections = markdown.split(/\n(?=##\s)/);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    if (!lines.length) continue;

    // 提取菜名：## 💕 1. 红烧肉 → 红烧肉
    const titleLine = lines[0];
    const titleMatch = titleLine.match(/##\s+(?:💕\s+)?(?:\d+\.\s+)?(.+)/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();
    if (!title || title.length < 2) continue;

    // 提取食材
    const ingredientsMatch = section.match(/\*\*食材[：:]\*\*\s*(.+)/);
    let ingredients = [];
    if (ingredientsMatch) {
      ingredients = ingredientsMatch[1]
        .split(/[、，,]/)
        .map(s => s.trim())
        .filter(Boolean);
    }

    // 提取步骤
    const stepsMatch = section.match(/\*\*做法[：:]\*\*([\s\S]*?)(?=💡|##|$)/);
    let steps = [];
    if (stepsMatch) {
      steps = stepsMatch[1]
        .split('\n')
        .map(s => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
    }

    // 提取小贴士
    const tipsMatch = section.match(/💡\s*小贴士[：:]?\s*(.+)/);
    const tips = tipsMatch ? tipsMatch[1].trim() : '';

    // 自动打标签（从标题和食材推断）
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

// GET /api/recipe/mine
// 查询我发布的菜谱列表
router.get('/mine', async (req, res) => {
  try {
    const openid = req.query.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const recipes = await Recipe.findAll({
      where: { authorOpenid: openid },
      order: [['created_at', 'DESC']],
    });
    res.json({ success: true, data: recipes });
  } catch (err) {
    console.error('[/api/recipe/mine]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recipe/update/:id
// 更新我发布的菜谱
router.post('/update/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const openid = req.body.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const recipe = await Recipe.findByPk(id);
    if (!recipe) return res.status(404).json({ error: '菜谱不存在' });
    if (recipe.authorOpenid !== openid) return res.status(403).json({ error: '无权限修改' });

    const { title, cover, ingredients, steps, duration, difficulty, tags, tips } = req.body;
    await recipe.update({
      title: title?.trim() || recipe.title,
      cover: cover !== undefined ? cover : recipe.cover,
      ingredients: ingredients !== undefined ? (typeof ingredients === 'string' ? ingredients : JSON.stringify(ingredients)) : recipe.ingredients,
      steps: steps !== undefined ? (typeof steps === 'string' ? steps : JSON.stringify(steps)) : recipe.steps,
      duration: duration || recipe.duration,
      difficulty: difficulty !== undefined ? Number(difficulty) : recipe.difficulty,
      tags: tags !== undefined ? tags : recipe.tags,
      tips: tips !== undefined ? tips : recipe.tips,
    });

    res.json({ success: true, data: recipe });
  } catch (err) {
    console.error('[/api/recipe/update]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recipe/delete/:id
// 删除我发布的菜谱
router.post('/delete/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const openid = req.body.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const recipe = await Recipe.findByPk(id);
    if (!recipe) return res.status(404).json({ error: '菜谱不存在' });
    if (recipe.authorOpenid !== openid) return res.status(403).json({ error: '无权限删除' });

    await recipe.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/recipe/delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.parseMarkdownRecipes = parseMarkdownRecipes;
