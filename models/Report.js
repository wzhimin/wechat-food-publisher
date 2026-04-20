const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Report = sequelize.define('Report', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '举报用户openid',
  },
  type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: '举报类型：recipe/comment',
  },
  target_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '目标ID（菜谱ID或评论ID）',
  },
  reason: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '举报原因',
  },
  detail: {
    type: DataTypes.STRING(500),
    defaultValue: '',
    comment: '详细说明',
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'pending',
    comment: '状态：pending/resolved/rejected',
  },
  handled_by: {
    type: DataTypes.STRING(50),
    comment: '处理人',
  },
  handled_at: {
    type: DataTypes.DATE,
    comment: '处理时间',
  },
  result: {
    type: DataTypes.STRING(200),
    comment: '处理结果说明',
  },
}, {
  tableName: 'reports',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Report;
