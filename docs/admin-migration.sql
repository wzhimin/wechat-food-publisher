-- 菜谱管理系统数据库迁移脚本
-- 在云开发数据库控制台或通过 SQL 执行

-- 1. 评论表增加审核状态
ALTER TABLE recipe_comments ADD COLUMN status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending';
ALTER TABLE recipe_comments ADD INDEX idx_status (status);

-- 2. 菜谱表增加审核状态和精选标志
ALTER TABLE recipes ADD COLUMN status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved';
ALTER TABLE recipes ADD COLUMN is_featured TINYINT(1) DEFAULT 0;
ALTER TABLE recipes ADD INDEX idx_recipe_status (status);
ALTER TABLE recipes ADD INDEX idx_is_featured (is_featured);

-- 3. 反馈表增加管理员回复字段
ALTER TABLE feedback ADD COLUMN admin_reply TEXT;
ALTER TABLE feedback ADD COLUMN handled_by VARCHAR(64);
ALTER TABLE feedback ADD COLUMN handled_at DATETIME;
ALTER TABLE feedback ADD INDEX idx_feedback_status (status);

-- 4. 更新已有数据：已有评论设为已通过
UPDATE recipe_comments SET status = 'approved' WHERE status IS NULL OR status = 'pending';

-- 5. 更新已有菜谱状态
UPDATE recipes SET status = 'approved' WHERE status IS NULL OR status = '';