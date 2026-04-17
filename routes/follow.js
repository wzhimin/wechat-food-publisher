const express = require('express');
const router = express.Router();
const UserFollow = require('../models/UserFollow');
const User = require('../models/User');

// POST /api/follow/toggle
// 切换关注状态
router.post('/toggle', async (req, res) => {
  try {
    const { followerOpenid, followingOpenid } = req.body;
    if (!followerOpenid || !followingOpenid) {
      return res.status(400).json({ error: '缺少参数' });
    }
    if (followerOpenid === followingOpenid) {
      return res.status(400).json({ error: '不能关注自己' });
    }

    const existing = await UserFollow.findOne({ where: { followerOpenid, followingOpenid } });

    if (existing) {
      await existing.destroy();
      // 粉丝数 -1
      await User.decrement('fans_count', { by: 1, where: { openid: followingOpenid } });
      // 关注数 -1
      await User.decrement('follow_count', { by: 1, where: { openid: followerOpenid } });
      res.json({ success: true, followed: false });
    } else {
      await UserFollow.create({ followerOpenid, followingOpenid });
      // 粉丝数 +1
      await User.increment('fansCount', { by: 1, where: { openid: followingOpenid } });
      // 关注数 +1
      await User.increment('followCount', { by: 1, where: { openid: followerOpenid } });
      res.json({ success: true, followed: true });
    }
  } catch (err) {
    console.error('[/api/follow/toggle]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/follow/status?follower=xxx&following=yyy
router.get('/status', async (req, res) => {
  try {
    const { follower, following } = req.query;
    const record = await UserFollow.findOne({ where: { followerOpenid: follower, followingOpenid: following } });
    res.json({ success: true, followed: !!record });
  } catch (err) {
    console.error('[/api/follow/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/follow/following?openid=xxx
router.get('/following', async (req, res) => {
  try {
    const openid = req.query.openid || req.body.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const follows = await UserFollow.findAll({ where: { followerOpenid: openid } });
    const followingOpenids = follows.map(f => f.followingOpenid);

    const users = followingOpenids.length
      ? await User.findAll({ where: { openid: followingOpenids }, attributes: ['openid', 'nickName', 'avatarUrl'] })
      : [];

    res.json({ success: true, data: users });
  } catch (err) {
    console.error('[/api/follow/following]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/follow/fans?openid=xxx
router.get('/fans', async (req, res) => {
  try {
    const openid = req.query.openid || req.body.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const fans = await UserFollow.findAll({ where: { followingOpenid: openid } });
    const fanOpenids = fans.map(f => f.followerOpenid);

    const users = fanOpenids.length
      ? await User.findAll({ where: { openid: fanOpenids }, attributes: ['openid', 'nickName', 'avatarUrl'] })
      : [];

    res.json({ success: true, data: users });
  } catch (err) {
    console.error('[/api/follow/fans]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
