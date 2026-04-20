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

  // 第二步：同步 Counter 表
  await Counter.sync({ alter: true });
}

// 导出初始化方法和模型
module.exports = {
  init,
  sequelize,
  Counter,
};
