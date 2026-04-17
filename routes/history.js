const express = require('express');
const router = express.Router();
const BrowseHistory = require('../models/BrowseHistory');
const Recipe = require('../models/Recipe');

// GET /api/history/list?openid=xxx
// 获取浏览历史（最近50条，含菜谱信息）
router.get('/list', async (req, res) => {
  try {
    const openid = req.query.openid || req.body.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const records = await BrowseHistory.findAll({
      where: { openid },
      order: [['viewedAt', 'DESC']],
      limit: 50,
    });

    // 填充菜谱信息
    const recipeIds = records.map(r => r.recipeId);
    const recipes = recipeIds.length
      ? await Recipe.findAll({ where: { id: recipeIds }, attributes: ['id', 'title', 'cover', 'difficulty', 'tags'] })
      : [];
    const recipeMap = Object.fromEntries(recipes.map(r => [r.id, r]));

    const data = records.map(r => {
      const recipe = recipeMap[r.recipeId] || {};
      return {
        id: r.id,
        recipeId: r.recipeId,
        viewedAt: r.viewedAt,
        title: recipe.title || '',
        cover: recipe.cover || '',
        difficulty: recipe.difficulty || 1,
        tags: recipe.tags || '',
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/history/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/history/add
// 记录一次浏览
router.post('/add', async (req, res) => {
  try {
    const openid = req.body.openid || req.query.openid;
    const { recipeId } = req.body;
    if (!openid || !recipeId) return res.status(400).json({ error: '缺少 openid 或 recipeId' });

    // 先删同用户的同菜谱记录（去重，保留最新）
    await BrowseHistory.destroy({ where: { openid, recipeId } });
    // 再插入新记录
    const record = await BrowseHistory.create({ openid, recipeId, viewedAt: new Date() });

    res.json({ success: true, data: record });
  } catch (err) {
    console.error('[/api/history/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/history/clear
// 清除全部浏览历史
router.delete('/clear', async (req, res) => {
  try {
    const openid = req.body.openid || req.query.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    await BrowseHistory.destroy({ where: { openid } });
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/history/clear]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
