/**
 * 非菜谱清理脚本
 * 用于从数据库中识别和标记/删除非菜谱内容
 */

const { Sequelize } = require('sequelize');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: 'bj-cdb-4gwh5hih-0a0b4d34-f0a8-11ed-9cf5-005056a06c2e.bj.cdb.myqcloud.com',
  port: 3306,
  user: 'root',
  password: 'Weikou2025@',
  database: 'wechat_food',
};

// 非菜谱关键词（标题中包含这些的视为非菜谱）
const NON_DISH_KEYWORDS = [
  '小贴士', '指南', '攻略', '技巧', '注意', '事项', '禁忌',
  '健康', '养生', '功效', '作用', '营养', '知识',
  '推荐', '必吃', '必做', '家常', '传统', '特色',
  '怎么吃', '如何吃', '做法大全', '菜谱大全',
];

// 纯食材名称（太短，可能是单独食材而非菜谱）
const SINGLE_INGREDIENTS = [
  '香椿', '春笋', '荠菜', '莴笋', '韭菜', '菠菜', '豆芽', '芦蒿', '蚕豆', '蒜苔',
];

async function main() {
  const connection = await mysql.createConnection(DB_CONFIG);
  
  console.log('🔍 检查菜谱数据...\n');
  
  // 1. 找出包含非菜谱关键词的
  let whereClause = NON_DISH_KEYWORDS.map(kw => `title LIKE '%${kw}%'`).join(' OR ');
  let [rows] = await connection.execute(
    `SELECT id, title, cover, created_at FROM recipes WHERE ${whereClause} ORDER BY created_at DESC`
  );
  
  console.log('📌 包含非菜谱关键词的：');
  for (const r of rows) {
    console.log(`  [${r.id}] ${r.title}`);
  }
  console.log(`共 ${rows.length} 条\n`);
  
  // 2. 找出纯食材名称的
  whereClause = SINGLE_INGREDIENTS.map(t => `title = '${t}'`).join(' OR ');
  if (whereClause) {
    [rows] = await connection.execute(
      `SELECT id, title, cover, created_at FROM recipes WHERE ${whereClause} ORDER BY created_at DESC`
    );
    
    console.log('📌 纯食材名称（可能是误同步的）：');
    for (const r of rows) {
      console.log(`  [${r.id}] ${r.title}`);
    }
    console.log(`共 ${rows.length} 条\n`);
  }
  
  // 3. 找出有封面的总数
  [rows] = await connection.execute(
    `SELECT COUNT(*) as cnt FROM recipes WHERE cover != '' AND cover IS NOT NULL`
  );
  console.log('📊 有封面的菜谱总数:', rows[0].cnt);
  
  // 4. 找出无封面的
  [rows] = await connection.execute(
    `SELECT COUNT(*) as cnt FROM recipes WHERE (cover = '' OR cover IS NULL)`
  );
  console.log('📊 无封面的菜谱总数:', rows[0].cnt);
  
  await connection.end();
  console.log('\n✅ 检查完成');
}

main().catch(console.error);