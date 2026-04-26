import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const isSqlite = config.db.driver === 'sqlite';

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

function normalizeSql(sql = '') {
  return sql
    .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bTRUE\b/gi, '1')
    .replace(/\bFALSE\b/gi, '0');
}

function normalizeParams(params = []) {
  return params.map((value) => {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return value;
  });
}

let sqliteDb;

function getSqliteDb() {
  if (!sqliteDb) {
    fs.mkdirSync(path.dirname(config.db.sqlitePath), { recursive: true });
    sqliteDb = new DatabaseSync(config.db.sqlitePath);
    sqliteDb.exec('PRAGMA foreign_keys = ON');
    sqliteDb.exec('PRAGMA journal_mode = WAL');
  }

  return sqliteDb;
}

function runSqliteStatement(sql, params = []) {
  const db = getSqliteDb();
  const statement = db.prepare(normalizeSql(sql));
  const normalizedParams = normalizeParams(params);

  if (/^\s*(select|pragma)\b/i.test(sql)) {
    return [statement.all(...normalizedParams)];
  }

  const result = statement.run(...normalizedParams);
  return [{
    affectedRows: result.changes,
    changes: result.changes,
    insertId: result.lastInsertRowid,
  }];
}

const sqlitePool = {
  async query(sql, params = []) {
    return runSqliteStatement(sql, params);
  },
  async execute(sql, params = []) {
    return runSqliteStatement(sql, params);
  },
  async end() {
    if (sqliteDb) {
      sqliteDb.close();
      sqliteDb = undefined;
    }
  },
};

const mysqlPool = mysql.createPool({
  ...connectionOptions,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  connectTimeout: 10000,
  idleTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
});

export const pool = isSqlite ? sqlitePool : mysqlPool;
