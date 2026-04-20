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
    const { status = 'approved', isFeatured, page = 1, pageSize = 50 } = req.query;
    const where = {};
    if (status !== 'all') where.status = status;
    if (isFeatured !== undefined) where.is_featured = isFeatured === '1' || isFeatured === 'true';
    
    const recipes = await Recipe.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
    });
    
    // 获取用户信息
    const openids = [...new Set(recipes.map(r => r.openid))];
    const users = await User.findAll({ where: { openid: openids }, attributes: ['openid', 'nickName'] });
    const userMap = Object.fromEntries(users.map(u => [u.openid, u]));
    
    const data = recipes.map(r => ({
      ...r.toJSON(),
      nickName: userMap[r.openid]?.nickName,
    }));
    
    res.json({ success: true, data });
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

module.exports = router;
