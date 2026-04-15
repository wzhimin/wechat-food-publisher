const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Todo = sequelize.define('Todo', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '所属用户openId',
  },
  title: {
    type: DataTypes.STRING(256),
    allowNull: false,
    comment: '任务标题',
  },
  done: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: '是否完成：0未完成 1已完成',
  },
  urgent: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: '是否紧急：0普通 1紧急',
  },
  taskTime: {
    type: DataTypes.STRING(64),
    comment: '任务时间',
  },
}, {
  tableName: 'todos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Todo;
