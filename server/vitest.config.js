import { defineConfig } from 'vitest/config';

// Tests use their own SQLite file (server/prisma/test.db), recreated on every run.
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.js'],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:4000',
      SESSION_SECRET: 'test-session-secret-test-session-secret-0123456789',
      DATABASE_URL: 'file:./test.db',
      SMTP_HOST: '',
      ADMIN_EMAIL: '',
      MAIN_ADMIN_EMAIL: '',
      SIDE_ADMIN_EMAIL: '',
      BREVO_API_KEY: '',
    },
  },
});
