import mysql from 'mysql2/promise';
import { config } from './config.js';

const connectionOptions = config.db.socketPath
  ? {
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      socketPath: config.db.socketPath,
    }
  : {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
    };

export const pool = mysql.createPool({
  ...connectionOptions,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,        // 连接超时 10 秒
  acquireTimeout: 10000,        // 获取连接超时 10 秒
  idleTimeout: 60000,           // 空闲连接 60 秒后释放
  enableKeepAlive: true,        // 保持连接活跃
  keepAliveInitialDelay: 30000, // 30 秒发送第一个 keepalive 包
});
