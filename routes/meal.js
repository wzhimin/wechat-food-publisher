const express = require('express');
const router = express.Router();
const axios = require('axios');
const COS = require('cos-nodejs-sdk-v5');
const MealPlan = require('../models/MealPlan');
const MealRecord = require('../models/MealRecord');
const Recipe = require('../models/Recipe');

// ========== COS 上传辅助函数 ==========
async function uploadToCOS(imageBuffer, folder = 'meal-photos') {
  const secretId = process.env.COS_SECRET_ID;
  const secretKey = process.env.COS_SECRET_KEY;
  const cdnDomain = process.env.COS_CDN_DOMAIN;

  if (!secretId || !secretKey) {
    throw new Error('缺少 COS_SECRET_ID 或 COS_SECRET_KEY 环境变量');
  }

  const filename = `meal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const key = `${folder}/${filename}`;

  const cos = new COS({ SecretId: secretId, SecretKey: secretKey });
  await cos.putObject({
    Bucket: 'cpdq-1257837176',
    Region: 'ap-guangzhou',
    Key: key,
    Body: imageBuffer,
    ContentType: 'image/jpeg',
  });

  return cdnDomain
    ? `https://${cdnDomain}/${key}`
    : `https://cpdq-1257837176.cos.ap-guangzhou.myqcloud.com/${key}`;
}

// ========== 通义千问 VL 识别 ==========
async function recognizeFoodByVL(base64Image) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('缺少 DASHSCOPE_API_KEY 环境变量');

  const response = await axios.post(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    {
      model: 'qwen-vl-max-latest',
      input: {
        messages: [{
          role: 'user',
          content: [
            { image: `data:image/jpeg;base64,${base64Image}` },
            { text: `请识别这张图片中的所有食物/饮品，并估算每种食物的重量和营养数据。

要求：
1. 识别出所有可见的食物和饮品
2. 估算每种食物的重量（克）
3. 估算每种食物的营养数据：热量(千卡)、蛋白质(g)、碳水(g)、脂肪(g)、膳食纤维(g)、钠(mg)

请严格按以下 JSON 格式返回，不要返回其他内容：
{
  "foods": [
    {
      "name": "食物名称",
      "weight_g": 150,
      "calories": 200,
      "protein": 8.5,
      "carbs": 25.0,
      "fat": 6.2,
      "fiber": 2.1,
      "sodium": 320
    }
  ],
  "total_calories": 200,
  "total_protein": 8.5,
  "total_carbs": 25.0,
  "total_fat": 6.2,
  "total_fiber": 2.1,
  "total_sodium": 320,
  "summary": "一盘番茄炒蛋约150g，搭配米饭约200g"
}` }
          ]
        }]
      },
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  // 解析 VL 返回
  const content = response.data?.output?.choices?.[0]?.message?.content;
  if (!content) throw new Error('通义千问 VL 返回内容为空');

  // 提取 JSON（VL 可能返回 markdown 包裹的 JSON）
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('无法从 VL 响应中提取 JSON');

  return JSON.parse(jsonMatch[0]);
}

// ========== 微信图片安全审核 ==========
async function checkImageSecurity(imageBuffer) {
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('media', imageBuffer, {
      filename: 'check.jpg',
      contentType: 'image/jpeg',
    });
    const res = await axios.post(
      'http://api.weixin.qq.com/wxa/img_sec_check',
      form,
      { headers: form.getHeaders() }
    );
    if (res.data.errcode === 0) return { passed: true };
    return { passed: false, reason: res.data.errmsg || '图片内容违规' };
  } catch (e) {
    console.warn('[图片审核] 调用失败:', e.message);
    return { passed: true, reason: '审核服务异常，已放行' };
  }
}

// ========== 原有接口 ==========

// GET /api/meal/list?date=2026-04-16&openid=xxx
router.get('/list', async (req, res) => {
  try {
    const openid = req.query.openid || '';
    const { date } = req.query;

    const where = {};
    if (date) where.planDate = date;
    if (openid) where.openid = openid;

    const plans = await MealPlan.findAll({ where, order: [['planDate', 'DESC'], ['created_at', 'ASC']] });

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
router.post('/add', async (req, res) => {
  try {
    const { openid, type, title, recipeId, date } = req.body;
    if (!openid || !type || !title) {
      return res.status(400).json({ error: '缺少 openid、type 或 title' });
    }
    if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(type)) {
      return res.status(400).json({ error: 'type 只能是 breakfast/lunch/dinner/snack' });
    }

    const planDate = date || new Date().toISOString().slice(0, 10);
    const plan = await MealPlan.create({ openid, type, title, recipeId: recipeId || null, done: 0, planDate });

    res.json({ success: true, data: plan });
  } catch (err) {
    console.error('[/api/meal/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/meal/update
router.post('/update', async (req, res) => {
  try {
    const { openid, id, done, title } = req.body;
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
router.post('/delete', async (req, res) => {
  try {
    const { openid, id } = req.body;
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
router.post('/subscribe', async (req, res) => {
  try {
    const { openid, templateIds } = req.body;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });
    console.log(`[订阅消息] 用户 ${openid} 授权推送，模板: ${JSON.stringify(templateIds)}`);
    res.json({ success: true, message: '订阅已记录' });
  } catch (err) {
    console.error('[/api/meal/subscribe]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 新增：拍照识别食物热量 ==========

// POST /api/meal/recognize
// Body: { openid, imageBase64, type?: 'breakfast'|'lunch'|'dinner'|'snack', date? }
router.post('/recognize', async (req, res) => {
  try {
    const { openid, imageBase64, type, date } = req.body;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });
    if (!imageBase64) return res.status(400).json({ error: '缺少 imageBase64' });

    // 1. 图片安全审核
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const checkResult = await checkImageSecurity(imageBuffer);
    if (!checkResult.passed) {
      return res.status(403).json({ error: '图片内容未通过安全审核', reason: checkResult.reason });
    }

    // 2. 调用通义千问 VL 识别
    let vlResult;
    try {
      vlResult = await recognizeFoodByVL(imageBase64);
    } catch (vlErr) {
      console.error('[/api/meal/recognize] VL 识别失败:', vlErr.message);
      return res.status(502).json({ error: '食物识别失败，请重试', detail: vlErr.message });
    }

    // 3. 上传图片到 COS
    let photoUrl = null;
    try {
      photoUrl = await uploadToCOS(imageBuffer);
    } catch (cosErr) {
      console.warn('[/api/meal/recognize] COS 上传失败，继续记录:', cosErr.message);
      // 图片上传失败不阻断，记录仍可保存
    }

    // 4. 构建食物名称摘要
    const foodNames = (vlResult.foods || []).map(f => f.name).join('、');
    const summary = vlResult.summary || foodNames;

    // 5. 存入 meal_records
    const mealType = type || 'lunch';
    const recordDate = date || new Date().toISOString().slice(0, 10);

    const record = await MealRecord.create({
      openid,
      type: mealType,
      photo_url: photoUrl,
      food_name: foodNames || '未知食物',
      calories: vlResult.total_calories || 0,
      protein: vlResult.total_protein || 0,
      carbs: vlResult.total_carbs || 0,
      fat: vlResult.total_fat || 0,
      fiber: vlResult.total_fiber || 0,
      sodium: vlResult.total_sodium || 0,
      food_details: vlResult.foods || [],
      estimate_method: 'ai',
      record_date: recordDate,
    });

    res.json({
      success: true,
      data: {
        record,
        summary,
        foods: vlResult.foods || [],
      },
    });
  } catch (err) {
    console.error('[/api/meal/recognize]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/meal/records — 手动创建饮食记录（无需拍照）
// Body: { openid, type, foodName, calories, protein?, carbs?, fat?, fiber?, sodium?, date? }
router.post('/records', async (req, res) => {
  try {
    const { openid, type, foodName, calories, protein, carbs, fat, fiber, sodium, date } = req.body;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });
    if (!foodName) return res.status(400).json({ error: '缺少 foodName' });
    if (calories === undefined || calories === null) return res.status(400).json({ error: '缺少 calories' });

    const mealType = type || 'lunch';
    if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(mealType)) {
      return res.status(400).json({ error: 'type 只能是 breakfast/lunch/dinner/snack' });
    }

    const record = await MealRecord.create({
      openid,
      type: mealType,
      photo_url: null,
      food_name: foodName,
      calories: Number(calories) || 0,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fat: Number(fat) || 0,
      fiber: Number(fiber) || 0,
      sodium: Number(sodium) || 0,
      food_details: [],
      estimate_method: 'manual',
      record_date: date || new Date().toISOString().slice(0, 10),
    });

    res.json({ success: true, data: { record } });
  } catch (err) {
    console.error('[/api/meal/records POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meal/records?openid=xxx&date=2026-04-23&type=lunch
router.get('/records', async (req, res) => {
  try {
    const openid = req.query.openid || '';
    const { date, type } = req.query;

    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const where = { openid };
    if (date) where.record_date = date;
    if (type) where.type = type;

    const records = await MealRecord.findAll({
      where,
      order: [['record_date', 'DESC'], ['created_at', 'DESC']],
    });

    // 按日期分组
    const grouped = {};
    records.forEach(r => {
      const d = r.record_date;
      if (!grouped[d]) grouped[d] = { date: d, records: [], total_calories: 0 };
      grouped[d].records.push(r);
      grouped[d].total_calories += r.calories || 0;
    });

    res.json({ success: true, data: Object.values(grouped) });
  } catch (err) {
    console.error('[/api/meal/records]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/meal/records/:id?openid=xxx
router.delete('/records/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const openid = req.query.openid || '';
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const record = await MealRecord.findOne({ where: { id, openid } });
    if (!record) return res.status(404).json({ error: '记录不存在' });

    await record.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/meal/records/:id DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meal/records/summary?openid=xxx&days=7
// 返回最近 N 天的每日热量汇总 + 营养素均值，用于趋势图
router.get('/records/summary', async (req, res) => {
  try {
    const openid = req.query.openid || '';
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const records = await MealRecord.findAll({
      where: { openid, record_date: { [require('sequelize').Op.gte]: sinceStr } },
      order: [['record_date', 'ASC']],
    });

    // 按日期汇总
    const dailyMap = {};
    records.forEach(r => {
      const d = r.record_date;
      if (!dailyMap[d]) dailyMap[d] = { date: d, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, count: 0 };
      dailyMap[d].calories += r.calories || 0;
      dailyMap[d].protein += r.protein || 0;
      dailyMap[d].carbs += r.carbs || 0;
      dailyMap[d].fat += r.fat || 0;
      dailyMap[d].fiber += r.fiber || 0;
      dailyMap[d].count++;
    });

    // 填充缺失日期（没有记录的天补0）
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      daily.push(dailyMap[ds] || { date: ds, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, count: 0 });
    }

    // 总体均值
    const daysWithData = daily.filter(d => d.count > 0);
    const avg = daysWithData.length ? {
      calories: Math.round(daysWithData.reduce((s, d) => s + d.calories, 0) / daysWithData.length),
      protein: Math.round(daysWithData.reduce((s, d) => s + d.protein, 0) / daysWithData.length * 10) / 10,
      carbs: Math.round(daysWithData.reduce((s, d) => s + d.carbs, 0) / daysWithData.length * 10) / 10,
      fat: Math.round(daysWithData.reduce((s, d) => s + d.fat, 0) / daysWithData.length * 10) / 10,
    } : { calories: 0, protein: 0, carbs: 0, fat: 0 };

    // 今日汇总
    const today = daily.find(d => d.date === new Date().toISOString().slice(0, 10)) || { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };

    res.json({ success: true, data: { daily, avg, today, daysWithData: daysWithData.length, totalDays: days } });
  } catch (err) {
    console.error('[/api/meal/records/summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
