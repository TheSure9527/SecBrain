import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        // node:sqlite 未列入 builtinModules（实验特性），需手动外部化
        external: ['node:sqlite']
      }
    }
  }
})
