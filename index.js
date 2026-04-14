const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '20mb' }));

// ========== 配置区 ==========
const APP_ID = process.env.WECHAT_APP_ID || 'wx85ae98c22a4d22e1';
const APP_SECRET = process.env.WECHAT_APP_SECRET;
const TOKEN = process.env.WECHAT_TOKEN || 'wechat_token_2024';

// ========== Access Token 缓存 ==========
let cachedToken = null;
let tokenExpireAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpireAt) return cachedToken;
  const res = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: {
      grant_type: 'client_credential',
      appid: APP_ID,
      secret: APP_SECRET,
    }
  });
  if (res.data.errcode) throw new Error(`获取Token失败: ${JSON.stringify(res.data)}`);
  cachedToken = res.data.access_token;
  tokenExpireAt = Date.now() + (res.data.expires_in - 300) * 1000;
  console.log('Access Token 刷新成功');
  return cachedToken;
}

// ========== 上传图片到永久素材 ==========
async function uploadImage(imageBuffer, token) {
  const form = new FormData();
  form.append('media', imageBuffer, {
    filename: 'cover.jpg',
    contentType: 'image/jpeg',
  });
  const res = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
    form,
    { headers: form.getHeaders() }
  );
  if (res.data.errcode) throw new Error(`上传图片失败: ${JSON.stringify(res.data)}`);
  return res.data.media_id;
}

// ========== 上传图片并返回URL（用于内容中插入图片）==========
async function uploadImageForContent(imageBuffer, token) {
  const form = new FormData();
  form.append('media', imageBuffer, {
    filename: 'content.jpg',
    contentType: 'image/jpeg',
  });
  const res = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
    form,
    { headers: form.getHeaders() }
  );
  if (res.data.errcode) throw new Error(`上传图片失败: ${JSON.stringify(res.data)}`);
  // 返回微信的图片URL
  return res.data.url;
}

// ========== 创建图文草稿 ==========
async function createDraft({ title, content, thumbMediaId, author, digest }, token) {
  const res = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`,
    {
      articles: [{
        title,
        author: author || 'AI美食助手',
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
async function publishDraft(mediaId, token) {
  const res = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`,
    { media_id: mediaId }
  );
  return res.data;
}

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
    if (!APP_SECRET) {
      return res.status(500).json({ error: '未配置 WECHAT_APP_SECRET 环境变量' });
    }

    const token = await getAccessToken();

    // 上传封面图（如果有）
    let thumbMediaId = null;
    if (imageBase64) {
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      thumbMediaId = await uploadImage(imageBuffer, token);
      console.log('封面图上传成功:', thumbMediaId);
    }

    // 创建草稿
    const draftMediaId = await createDraft({ title, content, thumbMediaId, author, digest }, token);
    console.log('草稿创建成功:', draftMediaId);

    // 发布
    let publishResult = null;
    if (autoPublish) {
      publishResult = await publishDraft(draftMediaId, token);
      console.log('发布结果:', publishResult);
    }

    res.json({
      success: true,
      draftMediaId,
      published: autoPublish,
      publishResult,
      message: autoPublish ? '草稿已创建并提交发布' : '草稿已创建，请手动发布',
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
  req.body.autoPublish = false;
  // 复用 /api/publish 逻辑
  const mockRes = {
    json: (data) => res.json(data),
    status: (code) => ({ json: (data) => res.status(code).json(data) }),
  };
  // 直接调用内部逻辑
  try {
    const { title, content, imageBase64, author, digest } = req.body;
    if (!title || !content) return res.status(400).json({ error: '缺少 title 或 content' });
    const token = await getAccessToken();
    let thumbMediaId = null;
    if (imageBase64) {
      const buf = Buffer.from(imageBase64, 'base64');
      thumbMediaId = await uploadImage(buf, token);
    }
    const draftMediaId = await createDraft({ title, content, thumbMediaId, author, digest }, token);
    res.json({ success: true, draftMediaId, message: '草稿创建成功，请到公众号后台手动发布' });
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
    if (!APP_SECRET) {
      return res.status(500).json({ error: '未配置 WECHAT_APP_SECRET 环境变量' });
    }

    const token = await getAccessToken();
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const imageUrl = await uploadImageForContent(imageBuffer, token);
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

const port = process.env.PORT || 80;
app.listen(port, '0.0.0.0', () => {
  console.log(`微信公众号发布服务启动，端口: ${port}`);
});
