const express = require('express');
const router = express.Router();
const MealPlan = require('../models/MealPlan');
const Recipe = require('../models/Recipe');

// GET /api/meal/list?date=2026-04-16&openid=xxx
// 获取某天的午餐/晚餐计划（openid 从 header 或 query 取）
// 内部推送脚本可传 query openid 查全部用户
router.get('/list', async (req, res) => {
  try {
    const openid = req.query.openid || req.headers['x-wx-openid'] || '';
    const { date } = req.query;

    const planDate = date || new Date().toISOString().slice(0, 10);

    const where = { planDate };
    if (openid) where.openid = openid;

    const plans = await MealPlan.findAll({
      where,
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
// 添加午餐/晚餐待办（openid 从 header 取）
// Body: { type: 'lunch'|'dinner', title, recipeId?, date? }
router.post('/add', async (req, res) => {
  try {
    const openid = req.headers['x-wx-openid'] || '';
    const { type, title, recipeId, date } = req.body;
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
// Body: { id, done?, title? }
router.post('/update', async (req, res) => {
  try {
    const openid = req.headers['x-wx-openid'] || '';
    const { id, done, title } = req.body;
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
// Body: { id }
router.post('/delete', async (req, res) => {
  try {
    const openid = req.headers['x-wx-openid'] || '';
    const { id } = req.body;
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

// POST /api/meal/subscribe
// 记录订阅消息授权（用户允许推送后调用）
// Body: { templateIds: [...] }
router.post('/subscribe', async (req, res) => {
  try {
    const openid = req.headers['x-wx-openid'] || '';
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    // 订阅消息是一次性的，前端授权后直接记录
    // 推送时再消耗，这里只做日志确认
    console.log(`[订阅消息] 用户 ${openid} 授权推送，模板: ${JSON.stringify(req.body.templateIds)}`);

    res.json({ success: true, message: '订阅已记录' });
  } catch (err) {
    console.error('[/api/meal/subscribe]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
