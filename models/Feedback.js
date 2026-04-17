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
}, {
  tableName: 'feedback',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Feedback;
