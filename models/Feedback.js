const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Feedback = sequelize.define('Feedback', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: '用户openid（可选）',
  },
  type: {
    type: DataTypes.ENUM('bug', 'suggest', 'other'),
    defaultValue: 'suggest',
    comment: '反馈类型',
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '反馈内容',
  },
  contact: {
    type: DataTypes.STRING(128),
    defaultValue: '',
    comment: '联系方式',
  },
  status: {
    type: DataTypes.ENUM('pending', 'replied', 'resolved'),
    defaultValue: 'pending',
    comment: '处理状态',
  },
  adminReply: {
    type: DataTypes.TEXT,
    comment: '管理员回复内容',
  },
  handledBy: {
    type: DataTypes.STRING(64),
    comment: '处理人',
  },
  handledAt: {
    type: DataTypes.DATE,
    comment: '处理时间',
  },
}, {
  tableName: 'feedbacks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  // 索引通过数据库迁移创建
});

module.exports = Feedback;
