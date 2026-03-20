import dotenv from 'dotenv';

dotenv.config();

const socketPath = process.env.DB_SOCKET || '/Applications/XAMPP/xamppfiles/var/mysql/mysql.sock';

export const config = {
  port: Number(process.env.PORT || 3001),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:8080',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3321),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'codex_pool_manager',
    socketPath,
  },
};
