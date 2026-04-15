const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '20mb' }));

// ========== 配置区 ==========
const APP_ID = process.env.WECHAT_APP_ID || 'wx85ae98c22a4d22e1';
const APP_SECRET = process.env.WECHAT_APP_SECRET;
const TOKEN = process.env.WECHAT_TOKEN || 'wechat_token_2024';

// 调试日志
console.log('环境变量 WECHAT_APP_ID:', APP_ID ? '已设置' : '未设置');
console.log('环境变量 WECHAT_APP_SECRET:', APP_SECRET ? '已设置' : '未设置');

// ========== Access Token 缓存 ==========
let cachedToken = null;
let tokenExpireAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpireAt) return cachedToken;

  async function fetchToken() {
    // 尝试用 client_credential（旧方式）
    const res = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
      params: {
        grant_type: 'client_credential',
        appid: APP_ID,
        secret: APP_SECRET,
      }
    });
    if (res.data.errcode) throw new Error(`获取Token失败: ${JSON.stringify(res.data)}`);
    return res.data.access_token;
  }

  try {
    cachedToken = await fetchToken();
  } catch (err) {
    // 40001 = token 过期，清缓存重试一次
    if (err.message.includes('40001')) {
      cachedToken = null;
      tokenExpireAt = 0;
      cachedToken = await fetchToken();
    } else {
      throw err;
    }
  }

  tokenExpireAt = Date.now() + (7200 - 300) * 1000;
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
async function publishDraft(mediaId, token) {
  const res = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`,
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

async function getDefaultThumbMediaId(token) {
  if (defaultThumbMediaId) return defaultThumbMediaId;
  const buf = generateDefaultCover();
  defaultThumbMediaId = await uploadImage(buf, token);
  console.log('默认封面上传成功:', defaultThumbMediaId);
  return defaultThumbMediaId;
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
    let thumbMediaId;
    if (imageBase64) {
      const buf = Buffer.from(imageBase64, 'base64');
      thumbMediaId = await uploadImage(buf, token);
    } else {
      // 没有封面图时使用默认封面
      thumbMediaId = await getDefaultThumbMediaId(token);
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
