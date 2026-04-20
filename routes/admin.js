/**
 * 管理后台 API
 * 用于评论、菜谱、反馈的审核管理
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize: dbSeq } = require('../db');
const RecipeComment = require('../models/RecipeComment');
const Recipe = require('../models/Recipe');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const RecipeLike = require('../models/RecipeLike');
const Collection = require('../models/Collection');
const BrowseHistory = require('../models/BrowseHistory');
const MealPlan = require('../models/MealPlan');

// ========== 管理员账号配置 ==========
// 生产环境应从数据库读取，这里简化处理
const ADMIN_ACCOUNTS = {
  'admin': {
    password: 'wang123456',  // 密码
    name: '管理员',
  }
};

// Token 存储（生产环境应使用 Redis 或数据库）
const TOKENS = new Map();  // token -> { username, expires }

// 生成 token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 验证 token
function verifyToken(token) {
  if (!token) return null;
  const info = TOKENS.get(token);
  if (!info) return null;
  if (Date.now() > info.expires) {
    TOKENS.delete(token);
    return null;
  }
  return info;
}

// 中间件：检查 token
function checkAuth(req, res, next) {
  const token = req.query.token || req.body.token || req.headers['x-admin-token'];
  const info = verifyToken(token);
  if (!info) {
    return res.status(401).json({ error: '未登录或 token 已过期' });
  }
  req.adminUser = info;
  next();
}

// ========== 登录 ==========

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '请输入账号和密码' });
    }
    
    const account = ADMIN_ACCOUNTS[username];
    if (!account || account.password !== password) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    
    // 生成 token，有效期 24 小时
    const token = generateToken();
    TOKENS.set(token, {
      username,
      name: account.name,
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });
    
    res.json({
      success: true,
      token,
      name: account.name,
    });
  } catch (err) {
    console.error('[/api/admin/login]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 统计数据 ==========

// GET /api/admin/stats
router.get('/stats', checkAuth, async (req, res) => {
  try {
    const [
      commentStats,
      recipeStats,
      feedbackStats,
    ] = await Promise.all([
      RecipeComment.findAll({
        attributes: ['status', [dbSeq.fn('COUNT', dbSeq.col('id')), 'count']],
        group: ['status'],
      }),
      Recipe.findAll({
        attributes: ['status', [dbSeq.fn('COUNT', dbSeq.col('id')), 'count']],
        group: ['status'],
      }),
      Feedback.findAll({
        attributes: ['status', [dbSeq.fn('COUNT', dbSeq.col('id')), 'count']],
        group: ['status'],
      }),
    ]);
    
    const formatStats = (arr) => {
      const result = {};
      arr.forEach(item => { result[item.status] = parseInt(item.dataValues.count); });
      return result;
    };
    
    res.json({
      success: true,
      data: {
        comments: formatStats(commentStats),
        recipes: formatStats(recipeStats),
        feedbacks: formatStats(feedbackStats),
      },
    });
  } catch (err) {
    console.error('[/api/admin/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 评论管理 ==========

// GET /api/admin/comments/list
router.get('/comments/list', checkAuth, async (req, res) => {
  try {
    const { status = 'pending', page = 1, pageSize = 50 } = req.query;
    const where = status !== 'all' ? { status } : {};
    
    const comments = await RecipeComment.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
    });
    
    // 获取用户信息
    const openids = [...new Set(comments.map(c => c.openid))];
    const users = await User.findAll({ where: { openid: openids }, attributes: ['openid', 'nickName', 'avatarUrl'] });
    const userMap = Object.fromEntries(users.map(u => [u.openid, u]));
    
    const data = comments.map(c => ({
      ...c.toJSON(),
      nickName: userMap[c.openid]?.nickName,
      avatarUrl: userMap[c.openid]?.avatarUrl,
    }));
    
    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/admin/comments/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/comments/approve
router.post('/comments/approve', checkAuth, async (req, res) => {
  try {
    const { commentId } = req.body;
    
    const comment = await RecipeComment.findByPk(commentId);
    if (!comment) {
      return res.status(404).json({ error: '评论不存在' });
    }
    
    comment.status = 'approved';
    await comment.save();
    
    // 增加评论计数
    await Recipe.increment('commentCount', { by: 1, where: { id: comment.recipeId } });
    
    res.json({ success: true, message: '评论已通过' });
  } catch (err) {
    console.error('[/api/admin/comments/approve]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/comments/reject
router.post('/comments/reject', checkAuth, async (req, res) => {
  try {
    const { commentId } = req.body;
    
    const comment = await RecipeComment.findByPk(commentId);
    if (!comment) {
      return res.status(404).json({ error: '评论不存在' });
    }
    
    comment.status = 'rejected';
    await comment.save();
    
    res.json({ success: true, message: '评论已拒绝' });
  } catch (err) {
    console.error('[/api/admin/comments/reject]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 菜谱管理 ==========

// GET /api/admin/recipes/list
router.get('/recipes/list', checkAuth, async (req, res) => {
  try {
    const { status = 'approved', isFeatured, search, page = 1, pageSize = 20 } = req.query;
    const where = {};
    if (status !== 'all') where.status = status;
    if (isFeatured !== undefined) where.is_featured = isFeatured === '1' || isFeatured === 'true';
    if (search && search.trim()) {
      where[Op.or] = [
        { title: { [Op.like]: `%${search.trim()}%` } },
      ];
    }
    
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const { count, rows: recipes } = await Recipe.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(pageSize),
      offset,
    });
    
    // 获取用户信息
    const openids = [...new Set(recipes.map(r => r.openid).filter(Boolean))];
    const users = openids.length 
      ? await User.findAll({ where: { openid: openids }, attributes: ['openid', 'nickName'] })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.openid, u.nickName]));
    
    const data = recipes.map(r => ({
      ...r.toJSON(),
      nickName: userMap[r.openid] || '系统',
    }));
    
    res.json({ 
      success: true, 
      data,
      total: count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (err) {
    console.error('[/api/admin/recipes/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/recipes/approve
router.post('/recipes/approve', checkAuth, async (req, res) => {
  try {
    const { recipeId } = req.body;
    
    const recipe = await Recipe.findByPk(recipeId);
    if (!recipe) {
      return res.status(404).json({ error: '菜谱不存在' });
    }
    
    recipe.status = 'approved';
    await recipe.save();
    
    res.json({ success: true, message: '菜谱已通过' });
  } catch (err) {
    console.error('[/api/admin/recipes/approve]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/recipes/reject
router.post('/recipes/reject', checkAuth, async (req, res) => {
  try {
    const { recipeId } = req.body;
    
    const recipe = await Recipe.findByPk(recipeId);
    if (!recipe) {
      return res.status(404).json({ error: '菜谱不存在' });
    }
    
    recipe.status = 'rejected';
    await recipe.save();
    
    res.json({ success: true, message: '菜谱已拒绝' });
  } catch (err) {
    console.error('[/api/admin/recipes/reject]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/recipes/feature
router.post('/recipes/feature', checkAuth, async (req, res) => {
  try {
    const { recipeId, isFeatured } = req.body;
    
    const recipe = await Recipe.findByPk(recipeId);
    if (!recipe) {
      return res.status(404).json({ error: '菜谱不存在' });
    }
    
    recipe.is_featured = isFeatured ? 1 : 0;
    await recipe.save();
    
    res.json({ success: true, message: isFeatured ? '已设为精选' : '已取消精选' });
  } catch (err) {
    console.error('[/api/admin/recipes/feature]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/recipes/update
router.post('/recipes/update', checkAuth, async (req, res) => {
  try {
    const { recipeId, title, cover, difficulty, duration, tags, tips } = req.body;
    
    const recipe = await Recipe.findByPk(recipeId);
    if (!recipe) {
      return res.status(404).json({ error: '菜谱不存在' });
    }
    
    if (title !== undefined) recipe.title = title;
    if (cover !== undefined) recipe.cover = cover;
    if (difficulty !== undefined) recipe.difficulty = difficulty;
    if (duration !== undefined) recipe.duration = duration;
    if (tags !== undefined) recipe.tags = tags;
    if (tips !== undefined) recipe.tips = tips;
    
    await recipe.save();
    
    res.json({ success: true, message: '菜谱已更新' });
  } catch (err) {
    console.error('[/api/admin/recipes/update]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/recipes/delete
router.post('/recipes/delete', checkAuth, async (req, res) => {
  try {
    const { recipeId } = req.body;
    
    const recipe = await Recipe.findByPk(recipeId);
    if (!recipe) {
      return res.status(404).json({ error: '菜谱不存在' });
    }
    
    // 删除关联数据
    await RecipeComment.destroy({ where: { recipeId } });
    await RecipeLike.destroy({ where: { recipeId } });
    await Collection.destroy({ where: { recipeId } });
    
    // 删除菜谱
    await recipe.destroy();
    
    res.json({ success: true, message: '菜谱已删除' });
  } catch (err) {
    console.error('[/api/admin/recipes/delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 反馈管理 ==========

// GET /api/admin/feedbacks/list
router.get('/feedbacks/list', checkAuth, async (req, res) => {
  try {
    const { status = 'pending', page = 1, pageSize = 50 } = req.query;
    const where = status !== 'all' ? { status } : {};
    
    const feedbacks = await Feedback.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
    });
    
    // 获取用户信息
    const openids = [...new Set(feedbacks.map(f => f.openid))];
    const users = await User.findAll({ where: { openid: openids }, attributes: ['openid', 'nickName', 'avatarUrl'] });
    const userMap = Object.fromEntries(users.map(u => [u.openid, u]));
    
    const data = feedbacks.map(f => ({
      ...f.toJSON(),
      nickName: userMap[f.openid]?.nickName,
      avatarUrl: userMap[f.openid]?.avatarUrl,
    }));
    
    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/admin/feedbacks/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/feedbacks/reply
router.post('/feedbacks/reply', checkAuth, async (req, res) => {
  try {
    const { feedbackId, reply } = req.body;
    
    if (!reply || !reply.trim()) {
      return res.status(400).json({ error: '请输入回复内容' });
    }
    
    const feedback = await Feedback.findByPk(feedbackId);
    if (!feedback) {
      return res.status(404).json({ error: '反馈不存在' });
    }
    
    feedback.admin_reply = reply.trim();
    feedback.status = 'resolved';
    feedback.handled_by = req.adminUser.username;
    feedback.handled_at = new Date();
    await feedback.save();
    
    res.json({ success: true, message: '回复已发送' });
  } catch (err) {
    console.error('[/api/admin/feedbacks/reply]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/feedbacks/resolve
router.post('/feedbacks/resolve', checkAuth, async (req, res) => {
  try {
    const { feedbackId } = req.body;
    
    const feedback = await Feedback.findByPk(feedbackId);
    if (!feedback) {
      return res.status(404).json({ error: '反馈不存在' });
    }
    
    feedback.status = 'resolved';
    feedback.handled_by = req.adminUser.username;
    feedback.handled_at = new Date();
    await feedback.save();
    
    res.json({ success: true, message: '已标记为已处理' });
  } catch (err) {
    console.error('[/api/admin/feedbacks/resolve]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 用户管理 ==========

// GET /api/admin/users/stats
router.get('/users/stats', checkAuth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const [
      totalUsers,
      todayUsers,
      activeUsers,
      contributors,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { created_at: { [Op.gte]: today } } }),
      User.count({ where: { last_login: { [Op.gte]: sevenDaysAgo } } }),
      dbSeq.query(
        'SELECT COUNT(DISTINCT openid) as count FROM recipes',
        { type: dbSeq.QueryTypes.SELECT }
      ),
    ]);
    
    res.json({
      success: true,
      data: {
        total: totalUsers,
        today: todayUsers,
        active7d: activeUsers,
        contributors: contributors[0]?.count || 0,
      },
    });
  } catch (err) {
    console.error('[/api/admin/users/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users/list
router.get('/users/list', checkAuth, async (req, res) => {
  try {
    const { page = 1, pageSize = 50 } = req.query;
    
    const { count, rows: users } = await User.findAndCountAll({
      attributes: ['openid', 'nickName', 'avatarUrl', 'created_at', 'last_login'],
      order: [['created_at', 'DESC']],
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
    });
    
    // 统计每个用户的数据
    const openids = users.map(u => u.openid).filter(Boolean);
    
    let recipeMap = {}, collectMap = {}, likeMap = {}, noteMap = {};
    
    if (openids.length > 0) {
      const [recipeCounts, collectCounts, likeCounts, noteCounts] = await Promise.all([
        dbSeq.query(
          'SELECT openid, COUNT(*) as count FROM recipes WHERE openid IN (?) GROUP BY openid',
          { replacements: [openids], type: dbSeq.QueryTypes.SELECT }
        ),
        dbSeq.query(
          'SELECT openid, COUNT(*) as count FROM collections WHERE openid IN (?) GROUP BY openid',
          { replacements: [openids], type: dbSeq.QueryTypes.SELECT }
        ),
        dbSeq.query(
          'SELECT openid, COUNT(*) as count FROM recipe_likes WHERE openid IN (?) GROUP BY openid',
          { replacements: [openids], type: dbSeq.QueryTypes.SELECT }
        ),
        dbSeq.query(
          'SELECT openid, COUNT(*) as count FROM recipe_notes WHERE openid IN (?) GROUP BY openid',
          { replacements: [openids], type: dbSeq.QueryTypes.SELECT }
        ),
      ]);
      
      const toMap = (arr) => Object.fromEntries(arr.map(x => [x.openid, x.count]));
      recipeMap = toMap(recipeCounts);
      collectMap = toMap(collectCounts);
      likeMap = toMap(likeCounts);
      noteMap = toMap(noteCounts);
    }
    
    const data = users.map(u => ({
      ...u.toJSON(),
      recipeCount: recipeMap[u.openid] || 0,
      collectCount: collectMap[u.openid] || 0,
      likeCount: likeMap[u.openid] || 0,
      noteCount: noteMap[u.openid] || 0,
    }));
    
    res.json({ success: true, data, total: count });
  } catch (err) {
    console.error('[/api/admin/users/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/recipes/non-dishes
// 列出可能是非菜谱的内容（无食材且无步骤）
router.get('/recipes/non-dishes', checkAuth, async (req, res) => {
  try {
    const { page = 1, pageSize = 50 } = req.query;
    
    // 先获取所有菜谱，然后在内存中过滤
    // 因为 ingredients 和 steps 是 JSON 字段，SQL 难以直接判断
    const allRecipes = await Recipe.findAll({
      attributes: ['id', 'title', 'cover', 'ingredients', 'steps', 'created_at'],
      order: [['created_at', 'DESC']],
    });
    
    // 过滤出无食材且无步骤的
    const nonDishes = allRecipes.filter(r => {
      let ingredients = [];
      let steps = [];
      try {
        ingredients = JSON.parse(r.ingredients || '[]');
      } catch (e) {}
      try {
        steps = JSON.parse(r.steps || '[]');
      } catch (e) {}
      
      // 无食材且无步骤 = 非菜谱
      return (!ingredients || ingredients.length === 0) && 
             (!steps || steps.length === 0);
    });
    
    const totalCount = nonDishes.length;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const pagedData = nonDishes.slice(offset, offset + parseInt(pageSize));
    
    const data = pagedData.map(r => ({
      id: r.id,
      title: r.title,
      cover: r.cover,
      hasSteps: false,
      hasIngredients: false,
      stepsCount: 0,
      ingredientsCount: 0,
      reasons: ['无食材', '无步骤'],
      created_at: r.created_at,
    }));
    
    res.json({ 
      success: true, 
      data, 
      total: totalCount, 
      rule: '无食材且无步骤' 
    });
  } catch (err) {
    console.error('[/api/admin/recipes/non-dishes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/recipes/batch-delete
// 批量删除菜谱
router.post('/recipes/batch-delete', checkAuth, async (req, res) => {
  try {
    const { token, recipeIds } = req.body;
    if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
      return res.status(400).json({ error: '请选择要删除的菜谱' });
    }
    
    // 先删除关联数据（RecipeNote 没有 recipeId，不关联菜谱）
    await Collection.destroy({ where: { recipeId: recipeIds } });
    await RecipeLike.destroy({ where: { recipeId: recipeIds } });
    await RecipeComment.destroy({ where: { recipeId: recipeIds } });
    await BrowseHistory.destroy({ where: { recipeId: recipeIds } });
    await MealPlan.destroy({ where: { recipeId: recipeIds } });
    
    // 删除菜谱
    const deleted = await Recipe.destroy({ where: { id: recipeIds } });
    
    res.json({ success: true, deleted, message: `成功删除 ${deleted} 条菜谱` });
  } catch (err) {
    console.error('[/api/admin/recipes/batch-delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
