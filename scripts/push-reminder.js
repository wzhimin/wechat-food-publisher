/**
 * 每日餐饮提醒推送脚本
 * 
 * 用法：
 *   node scripts/push-reminder.js          # 推送当前时段的提醒
 *   node scripts/push-reminder.js --dry    # 只看有哪些待推送，不实际发
 * 
 * 建议配合 cron 定时执行：
 *   午餐提醒 → 10:50 执行
 *   晚餐提醒 → 16:50 执行
 * 
 * 前提：
 *   1. 在微信公众平台申请订阅消息模板，获取模板 ID
 *   2. 将模板 ID 填入下方 TEMPLATE_IDS 配置
 *   3. 用户在前端加入午餐/晚餐时已调用 wx.requestSubscribeMessage 授权
 *   4. 云托管环境变量中需配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET（小程序的）
 */

const axios = require('axios');

// ========== 配置区 ==========
// 后端服务地址（云托管内网）
const API_BASE = process.env.API_BASE || 'http://localhost:80';

// 小程序 appid/secret（用于获取 access_token 发送订阅消息）
const MINI_APP_ID = process.env.MINI_APP_ID || '';
const MINI_APP_SECRET = process.env.MINI_APP_SECRET || '';

// 订阅消息模板 ID（替换为你在微信公众平台申请的模板）
const TEMPLATE_IDS = {
  lunch: process.env.TEMPLATE_LUNCH || '',   // 午餐提醒模板
  dinner: process.env.TEMPLATE_DINNER || '', // 晚餐提醒模板
};

// 推送时段
const LUNCH_HOUR = 11;   // 11:00 推送午餐提醒
const DINNER_HOUR = 17;  // 17:00 推送晚餐提醒

// ========== 获取 access_token ==========
async function getAccessToken() {
  if (!MINI_APP_ID || !MINI_APP_SECRET) {
    throw new Error('未配置 MINI_APP_ID 或 MINI_APP_SECRET');
  }
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${MINI_APP_ID}&secret=${MINI_APP_SECRET}`;
  const res = await axios.get(url);
  if (res.data.errcode) {
    throw new Error(`获取 access_token 失败: ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token;
}

// ========== 发送订阅消息 ==========
async function sendSubscribeMessage(accessToken, { openid, templateId, page, data }) {
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send`;
  const res = await axios.post(url, {
    touser: openid,
    template_id: templateId,
    page: page || 'pages/eatwhat/eatwhat',
    data,
  });
  if (res.data.errcode && res.data.errcode !== 0) {
    console.error(`[推送失败] openid=${openid} errcode=${res.data.errcode} errmsg=${res.data.errmsg}`);
    return false;
  }
  console.log(`[推送成功] openid=${openid}`);
  return true;
}

// ========== 主流程 ==========
async function main() {
  const isDry = process.argv.includes('--dry');

  // 判断当前时段
  const now = new Date();
  // 北京时间
  const bjHour = (now.getUTCHours() + 8) % 24;
  let type = null;
  if (bjHour >= 10 && bjHour < 14) {
    type = 'lunch';
  } else if (bjHour >= 16 && bjHour < 20) {
    type = 'dinner';
  } else {
    console.log(`当前北京时间 ${bjHour}:00，不在推送时段，跳过`);
    return;
  }

  const templateId = TEMPLATE_IDS[type];
  if (!templateId) {
    console.log(`未配置 ${type} 的模板 ID，跳过`);
    return;
  }

  console.log(`=== ${isDry ? '[试跑]' : ''} ${type === 'lunch' ? '午餐' : '晚餐'}提醒推送 ===`);

  // 查询今日该时段的计划
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  // 通过内部 API 获取计划（云托管内网）
  let plans = [];
  try {
    const res = await axios.get(`${API_BASE}/api/meal/list`, {
      params: { date: today },
      headers: { 'x-wx-openid': '__internal_cron__' },  // 内部请求标记
    });
    if (res.data && res.data.success) {
      plans = (res.data.data || []).filter(p => p.type === type);
    }
  } catch (e) {
    console.error('查询计划失败:', e.message);
    return;
  }

  if (plans.length === 0) {
    console.log('今日无计划，跳过');
    return;
  }

  // 按 openid 分组，汇总每个人的菜单
  const userPlans = {};
  for (const p of plans) {
    if (!userPlans[p.openid]) userPlans[p.openid] = [];
    userPlans[p.openid].push(p.title);
  }

  console.log(`共 ${Object.keys(userPlans).length} 位用户，${plans.length} 条计划`);

  if (isDry) {
    for (const [openid, titles] of Object.entries(userPlans)) {
      console.log(`  ${openid}: ${titles.join('、')}`);
    }
    return;
  }

  // 获取 access_token
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    console.error('获取 access_token 失败:', e.message);
    return;
  }

  // 逐个推送
  for (const [openid, titles] of Object.entries(userPlans)) {
    const summary = titles.join('、');
    try {
      await sendSubscribeMessage(accessToken, {
        openid,
        templateId,
        page: 'pages/eatwhat/eatwhat',
        data: {
          // 模板字段需与你在公众平台申请的模板一致
          // 以下是常见字段示例，实际以模板为准
          thing1: { value: type === 'lunch' ? '午餐提醒' : '晚餐提醒' },
          thing2: { value: summary.length > 20 ? summary.slice(0, 18) + '...' : summary },
          date3: { value: today },
        },
      });
    } catch (e) {
      console.error(`推送失败 openid=${openid}:`, e.message);
    }
  }

  console.log('推送完成');
}

main().catch(err => {
  console.error('脚本异常:', err);
  process.exit(1);
});
