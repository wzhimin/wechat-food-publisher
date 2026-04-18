const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// ========== 数据库初始化 ==========
const { init } = require('./db');
const User = require('./models/User');
const Todo = require('./models/Todo');
const Recipe = require('./models/Recipe');
const Collection = require('./models/Collection');
const MealPlan = require('./models/MealPlan');
const BrowseHistory = require('./models/BrowseHistory');
const Feedback = require('./models/Feedback');
const RecipeNote = require('./models/RecipeNote');
const RecipeLike = require('./models/RecipeLike');
const RecipeComment = require('./models/RecipeComment');
const UserFollow = require('./models/UserFollow');

// ========== 小程序接口路由 ==========
const userRouter = require('./routes/user');
const todoRouter = require('./routes/todo');
const recipeRouter = require('./routes/recipe');
const collectionRouter = require('./routes/collection');
const mealRouter = require('./routes/meal');
const { parseMarkdownRecipes } = require('./routes/recipe');
const historyRouter = require('./routes/history');
const feedbackRouter = require('./routes/feedback');
const noteRouter = require('./routes/note');
const likeRouter = require('./routes/like');
const commentRouter = require('./routes/comment');
const followRouter = require('./routes/follow');

const app = express();
app.use(express.json({ limit: '20mb' }));

// ========== 配置区 ==========
const APP_ID = process.env.WECHAT_APP_ID || 'wx85ae98c22a4d22e1';
const APP_SECRET = process.env.WECHAT_APP_SECRET;
const TOKEN = process.env.WECHAT_TOKEN || 'wechat_token_2024';

console.log('环境变量 WECHAT_APP_SECRET:', APP_SECRET ? '已设置' : '未设置');

// 开放接口服务：不需要 access_token，云托管自动鉴权
// 直接调用 http://api.weixin.qq.com/...

// ========== 上传图片到永久素材 ==========
async function uploadImage(imageBuffer) {
  const form = new FormData();
  form.append('media', imageBuffer, {
    filename: 'cover.jpg',
    contentType: 'image/jpeg',
  });
  const res = await axios.post(
    `http://api.weixin.qq.com/cgi-bin/material/add_material?type=image`,
    form,
    { headers: form.getHeaders() }
  );
  if (res.data.errcode) throw new Error(`上传图片失败: ${JSON.stringify(res.data)}`);
  return res.data.media_id;
}

// ========== 上传图片并返回URL（用于内容中插入图片）==========
async function uploadImageForContent(imageBuffer) {
  const form = new FormData();
  form.append('media', imageBuffer, {
    filename: 'content.jpg',
    contentType: 'image/jpeg',
  });
  const res = await axios.post(
    `http://api.weixin.qq.com/cgi-bin/material/add_material?type=image`,
    form,
    { headers: form.getHeaders() }
  );
  if (res.data.errcode) throw new Error(`上传图片失败: ${JSON.stringify(res.data)}`);
  return res.data.url;
}

// ========== 创建图文草稿 ==========
async function createDraft({ title, content, thumbMediaId, author, digest }) {
  const res = await axios.post(
    `http://api.weixin.qq.com/cgi-bin/draft/add`,
    {
      articles: [{
        title,
        author: author || '王先生kings',
        digest: digest || title,
        content,
        thumb_media_id: thumbMediaId,
        need_open_comment: 1,
        only_friend_can_comment: 0,
      }]
    }
  );
  if (res.data.errcode) throw new Error(`创建草稿失败: ${JSON.stringify(res.data)}`);
  return res.data.media_id;
}

// ========== 发布草稿 ==========
async function publishDraft(mediaId) {
  const res = await axios.post(
    `http://api.weixin.qq.com/cgi-bin/freepublish/submit`,
    { media_id: mediaId }
  );
  return res.data;
}

// ========== 生成默认封面图（1x1像素绿色JPEG）==========
function generateDefaultCover() {
  // 最小的有效JPEG（1x1像素，绿色背景）
  // 这是一个200x200的纯色JPEG，比1x1好看
  const jpegHex = 'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc000110800c800c803012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfc2800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a002800a0ffd9';
  return Buffer.from(jpegHex, 'hex');
}

// ========== 缓存默认封面mediaId ==========
let defaultThumbMediaId = null;

async function getDefaultThumbMediaId() {
  if (defaultThumbMediaId) return defaultThumbMediaId;
  const buf = generateDefaultCover();
  defaultThumbMediaId = await uploadImage(buf);
  console.log('默认封面上传成功:', defaultThumbMediaId);
  return defaultThumbMediaId;
}

// ========== HTML 转纯文本（用于从 HTML 内容中解析菜谱）==========
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ========== 菜谱同步接口 ==========
// POST /api/recipe/sync
// 公众号发布后，将 markdown 原文中的菜谱同步入库
// Body: { markdown, articleId? }
app.post('/api/recipe/sync', async (req, res) => {
  try {
    const { markdown, articleId } = req.body;
    if (!markdown) return res.status(400).json({ error: '缺少 markdown' });

    const recipes = parseMarkdownRecipes(markdown, {
      cover: null,
      articleId: articleId || null,
      publishedAt: new Date(),
    });

    if (recipes.length === 0) {
      return res.json({ success: true, count: 0, message: '未解析到菜谱，可能不是菜谱类文章' });
    }

    const created = await Recipe.bulkCreate(recipes, { ignoreDuplicates: true });
    console.log(`[菜谱同步] 成功入库 ${created.length} 道菜：${recipes.map(r => r.title).join(', ')}`);
    res.json({ success: true, count: created.length, data: created });
  } catch (err) {
    console.error('[/api/recipe/sync]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 路由 ==========

// 健康检查
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 微信签名校验（公众号后台配置服务器时用）
app.get('/api/wx', (req, res) => {
  const { signature, echostr, timestamp, nonce } = req.query;
  const arr = [TOKEN, timestamp, nonce].sort();
  const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  if (hash === signature) {
    res.send(echostr);
  } else {
    res.status(403).send('signature mismatch');
  }
});

// 主接口：创建图文草稿并发布
// POST /api/publish
// Body: { title, content, imageBase64?, author?, digest?, autoPublish? }
app.post('/api/publish', async (req, res) => {
  try {
    const { title, content, imageBase64, author, digest, autoPublish = true } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: '缺少必填字段: title 或 content' });
    }

    // 上传封面图（如果有）
    let thumbMediaId = null;
    if (imageBase64) {
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      thumbMediaId = await uploadImage(imageBuffer);
      console.log('封面图上传成功:', thumbMediaId);
    }

    // 创建草稿
    const draftMediaId = await createDraft({ title, content, thumbMediaId, author, digest });
    console.log('草稿创建成功:', draftMediaId);

    // 发布
    let publishResult = null;
    if (autoPublish) {
      publishResult = await publishDraft(draftMediaId);
      console.log('发布结果:', publishResult);
    }

    res.json({
      success: true,
      draftMediaId,
      published: autoPublish,
      publishResult,
      message: autoPublish ? '草稿已创建并提交发布' : '草稿已创建，请手动发布',
    });

    // 发布成功后自动解析菜谱入库（异步，不阻塞响应）
    setImmediate(async () => {
      try {
        // content 可能是 HTML，需要提取纯文本再解析
        const markdown = stripHtml(content);
        const recipes = parseMarkdownRecipes(markdown, {
          cover: null,
          articleId: draftMediaId,
          publishedAt: new Date(),
        });
        if (recipes.length > 0) {
          await Recipe.bulkCreate(recipes, { ignoreDuplicates: true });
          console.log(`[菜谱入库] 成功入库 ${recipes.length} 道菜：${recipes.map(r => r.title).join(', ')}`);
        } else {
          console.log('[菜谱入库] 未解析到菜谱，可能不是菜谱类文章');
        }
      } catch (err) {
        console.error('[菜谱入库] 失败:', err.message);
      }
    });

  } catch (err) {
    console.error('发布失败:', err.message);
    res.status(500).json({
      error: '发布失败',
      detail: err.message,
    });
  }
});

// 仅创建草稿（不发布）
app.post('/api/draft', async (req, res) => {
  try {
    const { title, content, imageBase64, author, digest } = req.body;
    if (!title || !content) return res.status(400).json({ error: '缺少 title 或 content' });

    let thumbMediaId;
    if (imageBase64) {
      const buf = Buffer.from(imageBase64, 'base64');
      thumbMediaId = await uploadImage(buf);
    } else {
      // 没有封面图时使用默认封面
      thumbMediaId = await getDefaultThumbMediaId();
    }
    const draftMediaId = await createDraft({ title, content, thumbMediaId, author, digest });
    res.json({ success: true, draftMediaId, message: '草稿创建成功，请到公众号后台手动发布' });

    // 发布成功后自动解析菜谱入库（异步，不阻塞响应）
    setImmediate(async () => {
      try {
        const markdown = stripHtml(content);
        const recipes = parseMarkdownRecipes(markdown, {
          cover: null,
          articleId: draftMediaId,
          publishedAt: new Date(),
        });
        if (recipes.length > 0) {
          await Recipe.bulkCreate(recipes, { ignoreDuplicates: true });
          console.log(`[菜谱入库] 成功入库 ${recipes.length} 道菜：${recipes.map(r => r.title).join(', ')}`);
        } else {
          console.log('[菜谱入库] 未解析到菜谱，可能不是菜谱类文章');
        }
      } catch (err) {
        console.error('[菜谱入库] 失败:', err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 上传图片并返回URL（用于文章内容中插入图片）
// POST /api/upload-image
// Body: { imageBase64 }
app.post('/api/upload-image', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: '缺少 imageBase64' });
    }

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const imageUrl = await uploadImageForContent(imageBuffer);
    console.log('内容图片上传成功:', imageUrl);

    res.json({
      success: true,
      imageUrl,
      message: '图片上传成功'
    });
  } catch (err) {
    console.error('图片上传失败:', err.message);
    res.status(500).json({
      error: '图片上传失败',
      detail: err.message,
    });
  }
});

// ========== 订阅消息推送 ==========
// POST /api/push/meal-reminder
// 由云托管定时器触发，推送用餐提醒
app.post('/api/push/meal-reminder', async (req, res) => {
  try {
    const { type } = req.body; // 'lunch' 或 'dinner'
    if (!type || !['lunch', 'dinner'].includes(type)) {
      return res.status(400).json({ error: '缺少或无效的 type 参数' });
    }

    // 模板 ID
    const TEMPLATE_ID = 'rS11TYryYUWVa1mzNguH9My99fcEcSZhrnoMw4WtkkQ';

    // 查询今日该时段的计划
    const today = new Date().toISOString().slice(0, 10);
    const plans = await MealPlan.findAll({
      where: { planDate: today, type },
    });

    if (plans.length === 0) {
      return res.json({ success: true, message: '今日无计划', pushed: 0 });
    }

    // 按 openid 分组
    const userPlans = {};
    for (const p of plans) {
      if (!userPlans[p.openid]) userPlans[p.openid] = [];
      userPlans[p.openid].push(p.title);
    }

    let pushed = 0;
    let failed = 0;

    // 逐个推送
    for (const [openid, titles] of Object.entries(userPlans)) {
      const summary = titles.join('、').slice(0, 20); // 限制 20 字
      const now = new Date();
      const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${type === 'lunch' ? '11:00' : '17:00'}`;

      try {
        // 云托管开放接口服务：直接调用 http://api.weixin.qq.com/
        const result = await axios.post('http://api.weixin.qq.com/wxa/msg/subscribe/send', {
          touser: openid,
          template_id: TEMPLATE_ID,
          page: 'pages/eatwhat/eatwhat',
          data: {
            date1: { value: `${today} ${type === 'lunch' ? '12:00' : '18:00'}` },  // 用餐时间
            name2: { value: '美食达人' },                                           // 用餐人
            thing3: { value: summary },                                              // 点餐内容
            thing4: { value: '请在用餐结束之前用餐' },                                // 备注
            time15: { value: now.toISOString().replace('T', ' ').slice(0, 19) },    // 订购时间
          },
        });

        if (result.data.errcode === 0) {
          pushed++;
          console.log(`[推送成功] ${openid}: ${summary}`);
        } else {
          failed++;
          console.error(`[推送失败] ${openid}:`, result.data);
        }
      } catch (e) {
        failed++;
        console.error(`[推送异常] ${openid}:`, e.message);
      }
    }

    res.json({
      success: true,
      message: `推送完成: 成功 ${pushed}，失败 ${failed}`,
      pushed,
      failed,
    });
  } catch (err) {
    console.error('[推送错误]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 订阅消息定时推送 ==========
// 服务一直运行，定时器也一直跑
// 午餐 11:00 推送，晚餐 17:00 推送
let lastPushDate = { lunch: null, dinner: null }; // 避免同一天重复推送

async function pushMealReminder(type) {
  const today = new Date().toISOString().slice(0, 10);
  const key = type;
  if (lastPushDate[key] === today) return; // 今天已推送，跳过

  const TEMPLATE_ID = 'rS11TYryYUWVa1mzNguH9My99fcEcSZhrnoMw4WtkkQ';

  try {
    const plans = await MealPlan.findAll({
      where: { planDate: today, type },
    });

    if (plans.length === 0) return;

    // 按 openid 分组
    const userPlans = {};
    for (const p of plans) {
      if (!userPlans[p.openid]) userPlans[p.openid] = [];
      userPlans[p.openid].push(p.title);
    }

    let pushed = 0, failed = 0;
    for (const [openid, titles] of Object.entries(userPlans)) {
      const summary = titles.join('、').slice(0, 20);
      const now = new Date();
      try {
        const result = await axios.post('http://api.weixin.qq.com/wxa/msg/subscribe/send', {
          touser: openid,
          template_id: TEMPLATE_ID,
          page: 'pages/eatwhat/eatwhat',
          data: {
            date1: { value: `${today} ${type === 'lunch' ? '12:00' : '18:00'}` },
            name2: { value: '美食达人' },
            thing3: { value: summary },
            thing4: { value: '请在用餐结束之前用餐' },
            time15: { value: now.toISOString().replace('T', ' ').slice(0, 19) },
          },
        });
        if (result.data.errcode === 0) {
          pushed++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }

    lastPushDate[key] = today;
    console.log(`[${type}] 推送完成: 成功 ${pushed}，失败 ${failed}`);
  } catch (err) {
    console.error(`[${type}] 推送异常:`, err.message);
  }
}

function scheduleReminders() {
  // 每 30 秒检查一次是否到点
  setInterval(() => {
    const now = new Date();
    const bjHour = (now.getUTCHours() + 8) % 24;
    const bjMin = now.getMinutes();

    // 11:00 触发午餐推送（误差 30 秒内）
    if (bjHour === 11 && bjMin === 0) {
      pushMealReminder('lunch');
    }
    // 17:00 触发晚餐推送
    if (bjHour === 17 && bjMin === 0) {
      pushMealReminder('dinner');
    }
  }, 30 * 1000);

  console.log('[定时器] 订阅消息推送已启动（午餐 11:00，晚餐 17:00）');
}

// ========== 注册小程序接口路由 ==========
app.use('/api/user', userRouter);
app.use('/api/todo', todoRouter);
app.use('/api/recipe', recipeRouter);
app.use('/api/collect', collectionRouter);
app.use('/api/meal', mealRouter);
app.use('/api/history', historyRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/note', noteRouter);
app.use('/api/like', likeRouter);
app.use('/api/comment', commentRouter);
app.use('/api/follow', followRouter);

const port = process.env.PORT || 80;

// ========== 启动 ==========
init()
  .then(async () => {
    // 旧模型同步
    await User.sync({ alter: 'safe' });
    await Todo.sync({ alter: 'safe' });
    await Recipe.sync({ alter: 'safe' });
    await Collection.sync({ alter: 'safe' });
    await MealPlan.sync({ alter: 'safe' });
    await BrowseHistory.sync({ alter: 'safe' });
    await Feedback.sync({ alter: 'safe' });
    await RecipeNote.sync({ alter: 'safe' });
    await RecipeLike.sync({ alter: 'safe' });
    await RecipeComment.sync({ alter: 'safe' });
    await UserFollow.sync({ alter: 'safe' });
    console.log('数据库初始化完成');

    app.listen(port, '0.0.0.0', () => {
      console.log(`服务启动，端口: ${port}`);
      scheduleReminders();
    });
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err.message);
    process.exit(1);
  });
