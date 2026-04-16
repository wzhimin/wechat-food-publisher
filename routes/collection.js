const express = require('express');
const router = express.Router();
const Collection = require('../models/Collection');
const Recipe = require('../models/Recipe');

// GET /api/collect/list?openid=xxx
// 获取我的收藏列表
router.get('/list', async (req, res) => {
  try {
    const { openid } = req.query;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const collections = await Collection.findAll({
      where: { openid },
      order: [['created_at', 'DESC']],
    });

    // 批量查菜谱详情
    const recipeIds = collections.map(c => c.recipeId);
    const recipes = recipeIds.length
      ? await Recipe.findAll({ where: { id: recipeIds } })
      : [];

    const recipeMap = {};
    recipes.forEach(r => { recipeMap[r.id] = r; });

    const data = collections.map(c => ({
      id: c.id,
      recipeId: c.recipeId,
      recipe: recipeMap[c.recipeId] || null,
      createdAt: c.created_at,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/collect/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collect/add
// 添加收藏
// Body: { openid, recipeId }
router.post('/add', async (req, res) => {
  try {
    const { openid, recipeId } = req.body;
    if (!openid || !recipeId) return res.status(400).json({ error: '缺少 openid 或 recipeId' });

    const [item, created] = await Collection.findOrCreate({
      where: { openid, recipeId },
    });

    res.json({ success: true, data: item, created });
  } catch (err) {
    console.error('[/api/collect/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collect/remove
// 取消收藏
// Body: { openid, recipeId }
router.post('/remove', async (req, res) => {
  try {
    const { openid, recipeId } = req.body;
    if (!openid || !recipeId) return res.status(400).json({ error: '缺少 openid 或 recipeId' });

    await Collection.destroy({ where: { openid, recipeId } });
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/collect/remove]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
