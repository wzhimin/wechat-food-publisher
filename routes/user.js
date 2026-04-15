const express = require('express');
const router = express.Router();
const User = require('../models/User');

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

module.exports = router;
