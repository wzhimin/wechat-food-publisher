const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const MealPlan = sequelize.define('MealPlan', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '用户openid',
  },
  type: {
    type: DataTypes.ENUM('lunch', 'dinner'),
    allowNull: false,
    comment: '午餐/晚餐',
  },
  title: {
    type: DataTypes.STRING(128),
    allowNull: false,
    comment: '菜名或自定义文字',
  },
  recipeId: {
    type: DataTypes.INTEGER,

    defaultValue: null,
    comment: '关联菜谱ID，可为空',
  },
  done: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: '是否完成：0未完成 1已完成',
  },
  planDate: {
    type: DataTypes.DATEONLY,

    allowNull: false,
    comment: '计划日期',
  },
}, {
  tableName: 'meal_plans',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = MealPlan;
