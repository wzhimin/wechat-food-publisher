const { Sequelize, DataTypes } = require("sequelize");

// 从环境变量中读取数据库配置
const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = "" } = process.env;

const [host, port] = MYSQL_ADDRESS.split(":");

const sequelize = new Sequelize("nodejs_demo", MYSQL_USERNAME, MYSQL_PASSWORD, {
  host,
  port,
  dialect: "mysql" /* one of 'mysql' | 'mariadb' | 'postgres' | 'mssql' */,
});

// 定义数据模型
const Counter = sequelize.define("Counter", {
  count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
});

// 数据库初始化方法
async function init() {
  // 第一步：清理 users 表历史遗留的 62 个重复 openid_N 索引
  // 必须在 Counter.sync({ alter: true }) 之前执行，否则 Sequelize 的 alter 检查
  // 会对已注册的 User 模型触发 schema 对比，遇到 64 索引上限直接报错
  try {
    const idxs = await sequelize.query(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA='nodejs_demo' AND TABLE_NAME='users' AND INDEX_NAME LIKE 'openid_%'",
      { type: sequelize.QueryTypes.SELECT }
    );
    for (const { INDEX_NAME } of idxs) {
      if (INDEX_NAME === 'openid') continue; // 保留主索引
      try {
        await sequelize.query(`DROP INDEX \`${INDEX_NAME}\` ON users`);
        console.log(`[清理] 删除 users.${INDEX_NAME}`);
      } catch (e) { /* 忽略已删 */ }
    }
  } catch (e) { console.error('[清理] 索引失败:', e.message); }

  // 第二步：修复 users 表（历史问题：缺 updated_at，可能有 openId 大写列）
  try {
    const [userCols] = await sequelize.query(`SHOW COLUMNS FROM users`);
    const colNames = userCols.map(c => c.Field);

    // 补 updated_at 列（Sequelize timestamps 依赖此列）
    if (!colNames.includes('updated_at')) {
      const hasCreatedAt = colNames.includes('created_at');
      if (hasCreatedAt) {
        await sequelize.query(`ALTER TABLE users ADD COLUMN updated_at DATETIME DEFAULT NULL`);
        console.log('[修复] users.updated_at 已补充');
      } else {
        await sequelize.query(`ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT NULL, ADD COLUMN updated_at DATETIME DEFAULT NULL`);
        console.log('[修复] users.created_at + updated_at 已补充');
      }
    }

    // 统一列名：openId → openid（历史遗留大小写不一致）
    if (colNames.includes('openId')) {
      await sequelize.query(`ALTER TABLE users CHANGE COLUMN openId openid VARCHAR(64) NOT NULL`);
      console.log('[迁移] users.openId → openid');
    }
  } catch (e) { console.error('[修复] users 表出错:', e.message); }

  // 第三步：迁移 feedback → feedbacks（历史命名错误）
  // 如果旧 feedback 表存在，rename 为 feedbacks；不存在则直接创建 feedbacks 表
  try {
    const [oldRows] = await sequelize.query(`SHOW TABLES LIKE 'feedback'`);
    const [newRows] = await sequelize.query(`SHOW TABLES LIKE 'feedbacks'`);
    if (oldRows.length > 0 && newRows.length === 0) {
      await sequelize.query('RENAME TABLE feedback TO feedbacks');
      console.log('[迁移] feedback → feedbacks 完成');
    } else if (newRows.length === 0) {
      await sequelize.query(`
        CREATE TABLE feedbacks (
          id INT AUTO_INCREMENT PRIMARY KEY,
          openid VARCHAR(64) DEFAULT NULL COMMENT '用户openid（可选）',
          type ENUM('bug','suggest','other') DEFAULT 'suggest' COMMENT '反馈类型',
          content TEXT NOT NULL COMMENT '反馈内容',
          contact VARCHAR(128) DEFAULT '' COMMENT '联系方式',
          status ENUM('pending','replied','resolved') DEFAULT 'pending' COMMENT '处理状态',
          adminReply TEXT COMMENT '管理员回复内容',
          handledBy VARCHAR(64) DEFAULT NULL COMMENT '处理人',
          handledAt DATETIME DEFAULT NULL COMMENT '处理时间',
          created_at DATETIME DEFAULT NULL,
          updated_at DATETIME DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户反馈'
      `);
      console.log('[迁移] feedbacks 表创建完成');
    } else {
      console.log('[迁移] feedbacks 表已存在，跳过');
    }
  } catch (e) { console.error('[迁移] feedbacks 出错:', e.message); }

  // 第四步：修复旧评论状态（一次性迁移，之后可删除）
  try {
    // 先扩大 status 列以支持 ENUM 值
    await sequelize.query("ALTER TABLE recipe_comments MODIFY COLUMN status VARCHAR(20) DEFAULT 'approved'");
    const [r1] = await sequelize.query("UPDATE recipe_comments SET status='approved' WHERE status IS NULL");
    if (r1.affectedRows > 0) console.log(`[迁移] recipe_comments status NULL → approved (${r1.affectedRows} 条)`);
    const [r2] = await sequelize.query("UPDATE recipe_comments SET status='approved' WHERE status='pending'");
    if (r2.affectedRows > 0) console.log(`[迁移] recipe_comments 旧 pending → approved (${r2.affectedRows} 条)`);
  } catch (e) { console.error('[迁移] recipe_comments status 修复出错:', e.message); }

  // 第三步：同步 Counter 表
  await Counter.sync({ alter: true });
}

// 导出初始化方法和模型
module.exports = {
  init,
  sequelize,
  Counter,
};
