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

// AdminToken 在 init() 内部 require，避免循环依赖（顶层 require 时 db.js 的 module.exports 还未生成）

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

  // ⚠️ 严禁使用 sync({ alter: true })！
  // Sequelize 的 alter 检查会触发 MySQL 索引统计，遇到 64 索引上限直接报错。
  // 正确做法：检查表是否存在，不存在才创建；新字段用手动 ALTER 添加。
  // 参见 commit 59c8566、ca91c22 的修复历史。

  // 第五步：同步 Counter 表（表存在就跳过）
  const [counterTable] = await sequelize.query(`SHOW TABLES LIKE 'Counters'`);
  if (counterTable.length === 0) {
    await Counter.sync();
    console.log('[sync] Counter 创建完成');
  }

  // 第六步：同步 admin_tokens 表（表存在就跳过）
  const AdminToken = require("./models/AdminToken");
  const [adminTokenTable] = await sequelize.query(`SHOW TABLES LIKE 'admin_tokens'`);
  if (adminTokenTable.length === 0) {
    await AdminToken.sync();
    console.log('[sync] AdminToken 创建完成');
  }

  // 第七步：同步 published_articles 表（表存在就跳过）
  const PublishedArticle = require('./models/PublishedArticle');
  const [publishedArticleTable] = await sequelize.query(`SHOW TABLES LIKE 'published_articles'`);
  if (publishedArticleTable.length === 0) {
    await PublishedArticle.sync();
    console.log('[sync] PublishedArticle 创建完成');
  }

  // 第八步：同步 Recipe 表（表存在就跳过，新字段手动 ALTER）
  const Recipe = require('./models/Recipe');
  const [recipeTable] = await sequelize.query(`SHOW TABLES LIKE 'recipes'`);
  if (recipeTable.length === 0) {
    await Recipe.sync();
    console.log('[sync] Recipe 创建完成');
  } else {
    // 表已存在，手动添加新字段（articleMd5、publishedArticleId）
    try {
      const [recipeCols] = await sequelize.query(`SHOW COLUMNS FROM recipes`);
      const colNames = recipeCols.map(c => c.Field);
      if (!colNames.includes('article_md5')) {
        await sequelize.query(`ALTER TABLE recipes ADD COLUMN article_md5 VARCHAR(32) DEFAULT NULL`);
        console.log('[迁移] recipes.article_md5 已添加');
      }
      if (!colNames.includes('published_article_id')) {
        await sequelize.query(`ALTER TABLE recipes ADD COLUMN published_article_id INT DEFAULT NULL`);
        console.log('[迁移] recipes.published_article_id 已添加');
      }
    } catch (e) { console.error('[迁移] Recipe 新字段出错:', e.message); }
  }

  // 第九步：确保 published_articles 表字符集为 utf8mb4（支持 emoji）
  try {
    await sequelize.query(
      "ALTER TABLE published_articles CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
    console.log('[修复] published_articles 字符集 → utf8mb4');
  } catch (e) { console.warn('[修复] published_articles 字符集出错:', e.message); }

  // 第十步：同步 meal_records 表（拍照识别食物热量功能）
  const MealRecord = require('./models/MealRecord');
  const [mealRecordTable] = await sequelize.query(`SHOW TABLES LIKE 'meal_records'`);
  if (mealRecordTable.length === 0) {
    await MealRecord.sync();
    console.log('[sync] MealRecord 创建完成');
  }

  // 第十一步：扩展 meal_plans 的 type 字段（lunch/dinner → breakfast/lunch/dinner/snack）
  try {
    const [typeRows] = await sequelize.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='nodejs_demo' AND TABLE_NAME='meal_plans' AND COLUMN_NAME='type'`
    );
    if (typeRows.length > 0 && !typeRows[0].COLUMN_TYPE.includes('breakfast')) {
      await sequelize.query(
        `ALTER TABLE meal_plans MODIFY COLUMN type ENUM('breakfast','lunch','dinner','snack') NOT NULL COMMENT '餐次类型：早餐/午餐/晚餐/加餐'`
      );
      console.log('[迁移] meal_plans.type 扩展 → breakfast/lunch/dinner/snack');
    }
  } catch (e) { console.warn('[迁移] meal_plans type 扩展出错:', e.message); }
}

// 导出初始化方法和模型
module.exports = {
  init,
  sequelize,
  Counter,
};