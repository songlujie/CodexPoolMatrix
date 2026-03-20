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
  namedPlaceholders: true,
});

export async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
