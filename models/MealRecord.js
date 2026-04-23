const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const MealRecord = sequelize.define('MealRecord', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '用户openid',
  },
  type: {
    type: DataTypes.ENUM('breakfast', 'lunch', 'dinner', 'snack'),
    allowNull: false,
    comment: '餐次类型',
  },
  photo_url: {
    type: DataTypes.STRING(512),
    allowNull: true,
    comment: '服务器 COS/CDN URL',
  },
  food_name: {
    type: DataTypes.STRING(128),
    allowNull: false,
    comment: '识别食物名称（多种食物时用逗号分隔）',
  },
  calories: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '热量(千卡)',
  },
  protein: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    comment: '蛋白质(g)',
  },
  carbs: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    comment: '碳水(g)',
  },
  fat: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    comment: '脂肪(g)',
  },
  fiber: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    comment: '膳食纤维(g)',
  },
  sodium: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    comment: '钠(mg)',
  },
  food_details: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '多种食物时的详细数据 JSON 数组',
  },
  estimate_method: {
    type: DataTypes.ENUM('ai', 'manual'),
    defaultValue: 'ai',
    comment: '估算方式：ai 自动 / manual 手动',
  },
  record_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '记录日期',
  },
}, {
  tableName: 'meal_records',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = MealRecord;
