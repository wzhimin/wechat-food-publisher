const express = require('express');
const router = express.Router();
const MealPlan = require('../models/MealPlan');
const Recipe = require('../models/Recipe');

// GET /api/meal/list?openid=xxx&date=2026-04-16
// 获取某天的午餐/晚餐计划
router.get('/list', async (req, res) => {
  try {
    const openid = req.query.openid || req.headers['x-wx-openid'] || '';
    const { date } = req.query;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const planDate = date || new Date().toISOString().slice(0, 10);

    const plans = await MealPlan.findAll({
      where: { openid, planDate },
      order: [['created_at', 'ASC']],
    });

    // 批量查关联菜谱
    const recipeIds = plans.map(p => p.recipeId).filter(Boolean);
    const recipes = recipeIds.length
      ? await Recipe.findAll({ where: { id: recipeIds } })
      : [];
    const recipeMap = {};
    recipes.forEach(r => { recipeMap[r.id] = r; });

    const data = plans.map(p => ({
      ...p.toJSON(),
      recipe: p.recipeId ? (recipeMap[p.recipeId] || null) : null,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/meal/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/meal/add
// 添加午餐/晚餐待办
// Body: { openid, type: 'lunch'|'dinner', title, recipeId?, date? }
router.post('/add', async (req, res) => {
  try {
    const { openid, type, title, recipeId, date } = req.body;
    const openid = req.body.openid || req.headers['x-wx-openid'] || '';
    if (!openid || !type || !title) {
      return res.status(400).json({ error: '缺少 openid、type 或 title' });
    }
    if (!['lunch', 'dinner'].includes(type)) {
      return res.status(400).json({ error: 'type 只能是 lunch 或 dinner' });
    }

    const planDate = date || new Date().toISOString().slice(0, 10);

    const plan = await MealPlan.create({
      openid,
      type,
      title,
      recipeId: recipeId || null,
      done: 0,
      planDate,
    });

    res.json({ success: true, data: plan });
  } catch (err) {
    console.error('[/api/meal/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/meal/update
// 更新待办（勾选完成/修改标题）
// Body: { id, openid, done?, title? }
router.post('/update', async (req, res) => {
  try {
    const { id, openid, done, title } = req.body;
    const openid = req.body.openid || req.headers['x-wx-openid'] || '';
    if (!id || !openid) return res.status(400).json({ error: '缺少 id 或 openid' });

    const plan = await MealPlan.findOne({ where: { id, openid } });
    if (!plan) return res.status(404).json({ error: '待办不存在' });

    const updates = {};
    if (done !== undefined) updates.done = done ? 1 : 0;
    if (title !== undefined) updates.title = title;

    await plan.update(updates);
    res.json({ success: true, data: plan });
  } catch (err) {
    console.error('[/api/meal/update]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/meal/delete
// 删除待办
// Body: { id, openid }
router.post('/delete', async (req, res) => {
  try {
    const { id, openid } = req.body;
    const openid = req.body.openid || req.headers['x-wx-openid'] || '';
    if (!id || !openid) return res.status(400).json({ error: '缺少 id 或 openid' });

    const plan = await MealPlan.findOne({ where: { id, openid } });
    if (!plan) return res.status(404).json({ error: '待办不存在' });

    await plan.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/meal/delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
