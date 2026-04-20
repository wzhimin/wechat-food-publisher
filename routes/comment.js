const express = require('express');
const router = express.Router();
const axios = require('axios');
const RecipeComment = require('../models/RecipeComment');
const Recipe = require('../models/Recipe');
const User = require('../models/User');

// ========== 微信内容安全 — 云调用 msgSecCheck ==========
const MINI_APP_ID = process.env.MINI_APP_ID || '';
const MINI_APP_SECRET = process.env.MINI_APP_SECRET || '';
let _tokenCache = null;
let _tokenExpire = 0;

async function getAccessToken() {
  if (_tokenCache && Date.now() < _tokenExpire) return _tokenCache;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${MINI_APP_ID}&secret=${MINI_APP_SECRET}`;
  const r = await axios.get(url).catch(() => null);
  if (r && r.data && r.data.access_token) {
    _tokenCache = r.data.access_token;
    _tokenExpire = Date.now() + ((r.data.expires_in || 7200) - 300) * 1000;
    return _tokenCache;
  }
  return null;
}

async function checkText(content) {
  if (!content || !content.trim()) return true;
  try {
    const token = await getAccessToken();
    if (!token) return true; // 没配置就跳过
    const url = `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`;
    const r = await axios.post(url, { content: content.trim() }).catch(() => null);
    if (r && r.data && r.data.errcode !== 0) {
      console.warn('[内容审核] 文本未通过', r.data);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[内容审核] msgSecCheck 调用失败', e.message);
    return true; // 审核服务异常时放行，不阻断用户
  }
}

// GET /api/comment/list
router.get('/list', async (req, res) => {
  try {
    const { recipeId } = req.query;
    if (!recipeId) return res.status(400).json({ error: '缺少 recipeId' });

    // 只显示已通过的评论
    const comments = await RecipeComment.findAll({
      where: { recipeId, replyTo: null, status: 'approved' },
      order: [['created_at', 'DESC']],
    });

    const openids = [...new Set(comments.map(c => c.openid))];
    const users = openids.length
      ? await User.findAll({ where: { openid: openids }, attributes: ['openid', 'nickName', 'avatarUrl'] })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.openid, u]));

    const commentIds = comments.map(c => c.id);
    const replies = commentIds.length
      ? await RecipeComment.findAll({ where: { replyTo: commentIds, status: 'approved' }, order: [['created_at', 'ASC']] })
      : [];

    const replyMap = {};
    replies.forEach(r => {
      if (!replyMap[r.replyTo]) replyMap[r.replyTo] = [];
      replyMap[r.replyTo].push({
        id: r.id,
        openid: r.openid,
        nickName: (userMap[r.openid] || {}).nickName || '用户',
        avatarUrl: (userMap[r.openid] || {}).avatarUrl || '',
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

    // ========== 内容安全审核 ==========
    const passed = await checkText(content);
    if (!passed) {
      return res.status(403).json({ error: '评论内容未通过安全审核，请修改后重试' });
    }

    const comment = await RecipeComment.create({
      openid,
      recipeId,
      content: content.trim(),
      replyTo: replyTo || null,
      status: 'pending',  // 新评论默认为待审核
    });

    // 评论数先不增加，等审核通过后再增加
    // await Recipe.increment('commentCount', { by: 1, where: { id: recipeId } });

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
