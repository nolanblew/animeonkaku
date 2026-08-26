import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // The Vitest config type currently resolves Vite through its own dependency tree.
  // The runtime plugin is the same Vite plugin and is safe at this boundary.
  plugins: [react() as any],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      exclude: [
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/**/*.test.*',
        'dist/**',
        'vite.config.ts',
      ],
    },
  },
})
