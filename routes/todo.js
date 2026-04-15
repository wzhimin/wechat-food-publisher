const express = require('express');
const router = express.Router();
const Todo = require('../models/Todo');

// 查询用户的所有待办
// GET /api/todo/list?openid=xxx
router.get('/list', async (req, res) => {
  try {
    const { openid } = req.query;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const todos = await Todo.findAll({
      where: { openid },
      order: [['created_at', 'DESC']],
    });

    res.json({ success: true, data: todos });
  } catch (err) {
    console.error('[/api/todo/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 新增待办
// POST /api/todo/add
// Body: { openid, title, urgent?, taskTime? }
router.post('/add', async (req, res) => {
  try {
    const { openid, title, urgent, taskTime } = req.body;
    if (!openid || !title) {
      return res.status(400).json({ error: '缺少 openid 或 title' });
    }

    const todo = await Todo.create({
      openid,
      title,
      done: 0,
      urgent: urgent ? 1 : 0,
      taskTime: taskTime || '',
    });

    res.json({ success: true, data: todo });
  } catch (err) {
    console.error('[/api/todo/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 更新待办（改状态/标题等）
// POST /api/todo/update
// Body: { id, openid, title?, done?, urgent?, taskTime? }
router.post('/update', async (req, res) => {
  try {
    const { id, openid, title, done, urgent, taskTime } = req.body;
    if (!id || !openid) {
      return res.status(400).json({ error: '缺少 id 或 openid' });
    }

    const todo = await Todo.findOne({ where: { id, openid } });
    if (!todo) {
      return res.status(404).json({ error: '待办不存在' });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (done !== undefined) updates.done = done ? 1 : 0;
    if (urgent !== undefined) updates.urgent = urgent ? 1 : 0;
    if (taskTime !== undefined) updates.taskTime = taskTime;

    await todo.update(updates);
    res.json({ success: true, data: todo });
  } catch (err) {
    console.error('[/api/todo/update]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 删除待办
// POST /api/todo/delete
// Body: { id, openid }
router.post('/delete', async (req, res) => {
  try {
    const { id, openid } = req.body;
    if (!id || !openid) {
      return res.status(400).json({ error: '缺少 id 或 openid' });
    }

    const todo = await Todo.findOne({ where: { id, openid } });
    if (!todo) {
      return res.status(404).json({ error: '待办不存在' });
    }

    await todo.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/todo/delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
