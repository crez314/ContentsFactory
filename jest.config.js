module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts', '<rootDir>/libs/**/*.spec.ts'],
  moduleNameMapper: {
    '^@cf/common$': '<rootDir>/libs/common/src/index.ts',
    '^@cf/common/(.*)$': '<rootDir>/libs/common/src/$1',
    '^@cf/domain$': '<rootDir>/libs/domain/src/index.ts',
    '^@cf/domain/(.*)$': '<rootDir>/libs/domain/src/$1',
    '^@cf/database$': '<rootDir>/libs/database/src/index.ts',
    '^@cf/database/(.*)$': '<rootDir>/libs/database/src/$1',
    '^@cf/orchestration$': '<rootDir>/libs/orchestration/src/index.ts',
    '^@cf/orchestration/(.*)$': '<rootDir>/libs/orchestration/src/$1',
    '^@cf/queue$': '<rootDir>/libs/queue/src/index.ts',
    '^@cf/queue/(.*)$': '<rootDir>/libs/queue/src/$1',
    '^@cf/model-abstraction$': '<rootDir>/libs/model-abstraction/src/index.ts',
    '^@cf/model-abstraction/(.*)$': '<rootDir>/libs/model-abstraction/src/$1',
    '^@cf/storage$': '<rootDir>/libs/storage/src/index.ts',
    '^@cf/storage/(.*)$': '<rootDir>/libs/storage/src/$1',
    '^@cf/contracts$': '<rootDir>/libs/contracts/src/index.ts',
    '^@cf/contracts/(.*)$': '<rootDir>/libs/contracts/src/$1'
  },
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { experimentalDecorators: true, emitDecoratorMetadata: true, target: 'ES2022', strictPropertyInitialization: false } }] },
  collectCoverageFrom: ['libs/domain/src/**/*.ts', '!libs/domain/src/entities/**']
};
