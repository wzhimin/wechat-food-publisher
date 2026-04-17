const express = require('express');
const router = express.Router();
const RecipeLike = require('../models/RecipeLike');
const Recipe = require('../models/Recipe');

// POST /api/like/toggle
// 切换点赞状态：已点赞则取消，未点赞则添加
router.post('/toggle', async (req, res) => {
  try {
    const { openid, recipeId } = req.body;
    if (!openid || !recipeId) return res.status(400).json({ error: '缺少 openid 或 recipeId' });

    const existing = await RecipeLike.findOne({ where: { openid, recipeId } });

    if (existing) {
      await existing.destroy();
      // 点赞数 -1
      await Recipe.decrement('like_count', { by: 1, where: { id: recipeId } });
      res.json({ success: true, liked: false });
    } else {
      await RecipeLike.create({ openid, recipeId });
      // 点赞数 +1
      await Recipe.increment('likeCount', { by: 1, where: { id: recipeId } });
      res.json({ success: true, liked: true });
    }
  } catch (err) {
    console.error('[/api/like/toggle]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/like/status?openid=xxx&recipeIds=1,2,3
// 批量查询点赞状态
router.get('/status', async (req, res) => {
  try {
    const openid = req.query.openid || req.body.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const ids = (req.query.recipeIds || '').split(',').map(Number).filter(Boolean);
    if (!ids.length) return res.json({ success: true, data: {} });

    const likes = await RecipeLike.findAll({ where: { openid, recipeId: ids } });
    const likedMap = Object.fromEntries(likes.map(l => [l.recipeId, true]));
    const data = Object.fromEntries(ids.map(id => [id, !!likedMap[id]]));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/like/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
