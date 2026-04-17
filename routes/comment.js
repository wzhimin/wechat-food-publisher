const express = require('express');
const router = express.Router();
const RecipeComment = require('../models/RecipeComment');
const User = require('../models/User');

// GET /api/comment/list?recipeId=xxx
router.get('/list', async (req, res) => {
  try {
    const { recipeId } = req.query;
    if (!recipeId) return res.status(400).json({ error: '缺少 recipeId' });

    const comments = await RecipeComment.findAll({
      where: { recipeId, replyTo: null },
      order: [['created_at', 'DESC']],
    });

    // 填充评论者信息
    const openids = [...new Set(comments.map(c => c.openid))];
    const users = openids.length
      ? await User.findAll({ where: { openid: openids }, attributes: ['openid', 'nickName', 'avatarUrl'] })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.openid, u]));

    // 填充回复
    const commentIds = comments.map(c => c.id);
    const replies = commentIds.length
      ? await RecipeComment.findAll({ where: { replyTo: commentIds }, order: [['created_at', 'ASC']] })
      : [];

    const replyUserMap = {};
    const replyOpenids = [...new Set(replies.map(r => r.openid))];
    if (replyOpenids.length) {
      const ru = await User.findAll({ where: { openid: replyOpenids }, attributes: ['openid', 'nickName', 'avatarUrl'] });
      replyOpenids.forEach(u => { replyUserMap[u] = null; });
      ru.forEach(u => { replyUserMap[u.openid] = u; });
    }

    const replyMap = {};
    replies.forEach(r => {
      if (!replyMap[r.replyTo]) replyMap[r.replyTo] = [];
      replyMap[r.replyTo].push({
        id: r.id,
        openid: r.openid,
        nickName: (replyUserMap[r.openid] || {}).nickName || '用户',
        avatarUrl: (replyUserMap[r.openid] || {}).avatarUrl || '',
        content: r.content,
        replyTo: r.replyTo,
        createdAt: r.created_at,
      });
    });

    const data = comments.map(c => ({
      id: c.id,
      openid: c.openid,
      nickName: (userMap[c.openid] || {}).nickName || '用户',
      avatarUrl: (userMap[c.openid] || {}).avatarUrl || '',
      content: c.content,
      replyTo: c.replyTo,
      createdAt: c.created_at,
      replies: replyMap[c.id] || [],
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/comment/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comment/add
router.post('/add', async (req, res) => {
  try {
    const { openid, recipeId, content, replyTo } = req.body;
    if (!openid || !recipeId) return res.status(400).json({ error: '缺少 openid 或 recipeId' });
    if (!content || !content.trim()) return res.status(400).json({ error: '请输入评论内容' });

    const comment = await RecipeComment.create({
      openid,
      recipeId,
      content: content.trim(),
      replyTo: replyTo || null,
    });

    // 评论数 +1
    await Recipe.increment('comment_count', { by: 1, where: { id: recipeId } });

    // 填充用户信息
    const user = await User.findOne({ where: { openid }, attributes: ['openid', 'nickName', 'avatarUrl'] });

    res.json({
      success: true,
      data: {
        id: comment.id,
        openid,
        nickName: (user || {}).nickName || '用户',
        avatarUrl: (user || {}).avatarUrl || '',
        content: content.trim(),
        replyTo: comment.replyTo,
        createdAt: comment.created_at,
        replies: [],
      },
    });
  } catch (err) {
    console.error('[/api/comment/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
