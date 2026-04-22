/**
 * 初始化 admin_tokens 表
 * 用法: node scripts/create-admin-tokens-table.js
 *
 * 直接用 raw SQL 创建表，避免 Sequelize Model 加载顺序问题。
 * 创建完成后正常重启服务即可。
 */
const mysql = require('mysql2/promise');

async function main() {
  const {
    MYSQL_USERNAME,
    MYSQL_PASSWORD,
    MYSQL_ADDRESS = '',
  } = process.env;

  const [host, port = '3306'] = MYSQL_ADDRESS.split(':');
  const dbName = 'nodejs_demo';

  console.log(`连接 ${host}:${port}...`);
  const connection = await mysql.createConnection({
    host,
    port,
    user: MYSQL_USERNAME,
    password: MYSQL_PASSWORD,
    database: dbName,
  });

  // 检查表是否已存在
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'admin_tokens'`,
    [dbName]
  );

  if (rows.length > 0) {
    console.log('✅ admin_tokens 表已存在，无需迁移');
    await connection.end();
    return;
  }

  // 创建表
  await connection.query(`
    CREATE TABLE admin_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token VARCHAR(80) NOT NULL UNIQUE COMMENT '管理员登录 token',
      username VARCHAR(64) NOT NULL COMMENT '管理员账号',
      name VARCHAR(64) DEFAULT NULL COMMENT '管理员姓名',
      expires_at DATETIME NOT NULL COMMENT 'token 过期时间',
      created_at DATETIME DEFAULT NULL,
      updated_at DATETIME DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员登录 token 表'
  `);

  console.log('✅ admin_tokens 表创建完成');
  await connection.end();

  // 插入一条临时 token 用于修复登录
  // 账号: admin / 密码: wang123456
  const crypto = require('crypto');
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const conn2 = await mysql.createConnection({ host, port, user: MYSQL_USERNAME, password: MYSQL_PASSWORD, database: dbName });
  await conn2.query(
    'INSERT INTO admin_tokens (token, username, name, expires_at) VALUES (?, ?, ?, ?)',
    [token, 'admin', '管理员', expiresAt]
  );
  console.log(`\n✅ 临时 token 已写入（7 天有效）:`);
  console.log(`   账号: admin`);
  console.log(`   token: ${token}`);
  console.log('\n请用这个 token 直接访问后台:\n');
  console.log(`   http://你的后台地址/admin/index.html?token=${token}`);
  console.log('\n登录后记得重新登录（会自动写入新 token）\n');

  await conn2.end();
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});