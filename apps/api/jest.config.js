/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/evals/**/*.spec.ts',
    '<rootDir>/test/**/*.e2e-spec.ts',
  ],
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  testTimeout: 30000,
};
