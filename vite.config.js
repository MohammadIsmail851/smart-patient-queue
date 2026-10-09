import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/ed/**/*.test.js'],
  },
});
