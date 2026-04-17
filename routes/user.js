const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');

// 小程序 appid/secret（需在云托管环境变量中配置）
const MINI_APP_ID = process.env.MINI_APP_ID || '';
const MINI_APP_SECRET = process.env.MINI_APP_SECRET || '';

// ========== 微信 code 换 openid ==========
async function code2openid(code) {
  if (!MINI_APP_ID || !MINI_APP_SECRET) {
    throw new Error('后端未配置 MINI_APP_ID 或 MINI_APP_SECRET');
  }
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${MINI_APP_ID}&secret=${MINI_APP_SECRET}&js_code=${code}&grant_type=authorization_code`;
  const res = await axios.get(url);
  if (res.data.errcode) {
    throw new Error(`微信接口返回错误: ${res.data.errmsg} (${res.data.errcode})`);
  }
  return res.data.openid;
}

// 登录：首次用 wx.login() 的 code 换 openid，后续用 body.openid
// POST /api/user/login
// Body: { code, nickName?, avatarUrl? }  首次登录传 code
// Body: { openid, nickName?, avatarUrl? }  已有 openid 时传 openid
router.post('/login', async (req, res) => {
  try {
    let openid;

    // 优先从 body 取 code，兑换 openid（首次登录流程）
    if (req.body.code) {
      openid = await code2openid(req.body.code);
    }
    // 兜底：从 body/query 取已有 openid（后续登录）
    if (!openid) {
      openid = req.body.openid || req.query.openid;
    }

    if (!openid) {
      return res.status(400).json({ error: '无法获取用户身份（缺少 code 或 openid）' });
    }

    const { nickName, avatarUrl } = req.body;
    let user = await User.findOne({ where: { openid } });

    if (!user) {
      user = await User.create({
        openid,
        nickName: nickName || '',
        avatarUrl: avatarUrl || '',
      });
    } else {
      const updates = {};
      if (nickName !== undefined) updates.nickName = nickName;
      if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
      if (Object.keys(updates).length > 0) {
        await user.update(updates);
      }
    }

    res.json({ success: true, openid, data: user });
  } catch (err) {
    console.error('[/api/user/login]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 查询或创建用户资料
// POST /api/user/profile
// Body: { openid, nickName?, avatarUrl? }
router.post('/profile', async (req, res) => {
  try {
    const { openid, nickName, avatarUrl } = req.body;

    if (!openid) {
      return res.status(400).json({ error: '缺少 openid' });
    }

    let user = await User.findOne({ where: { openid } });

    if (!user) {
      // 首次创建
      user = await User.create({ openid, nickName: nickName || '', avatarUrl: avatarUrl || '' });
      return res.json({ success: true, data: user, created: true });
    }

    // 更新字段（只更新传入的字段）
    const updates = {};
    if (nickName !== undefined) updates.nickName = nickName;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

    if (Object.keys(updates).length > 0) {
      await user.update(updates);
    }

    res.json({ success: true, data: user, created: false });
  } catch (err) {
    console.error('[/api/user/profile]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 获取用户资料
// GET /api/user/profile?openid=xxx
router.get('/profile', async (req, res) => {
  try {
    const { openid } = req.query;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const user = await User.findOne({ where: { openid } });
    if (!user) {
      return res.json({ success: true, data: null, message: '用户不存在' });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    console.error('[/api/user/profile GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 获取用户统计（关注数、粉丝数、获赞数）
// GET /api/user/stats?openid=xxx
router.get('/stats', async (req, res) => {
  try {
    const { openid } = req.query;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const UserFollow = require('../models/UserFollow');
    const RecipeLike = require('../models/RecipeLike');

    // 关注数（我关注了多少人）
    const followCount = await UserFollow.count({ where: { followerOpenid: openid } });
    // 粉丝数（多少人关注了我）
    const fansCount = await UserFollow.count({ where: { followingOpenid: openid } });
    // 获赞数（我发布的菜谱收到的点赞总数）
    const Recipe = require('../models/Recipe');
    const myRecipes = await Recipe.findAll({
      where: { authorOpenid: openid },
      attributes: ['likeCount'],
    });
    const likeCount = myRecipes.reduce((sum, r) => sum + (r.likeCount || 0), 0);

    res.json({
      success: true,
      data: {
        followCount,
        fansCount,
        likeCount,
      },
    });
  } catch (err) {
    console.error('[/api/user/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
