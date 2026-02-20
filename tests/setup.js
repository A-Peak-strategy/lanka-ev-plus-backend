// Test setup file
// Mock environment variables
process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.NODE_ENV = "test";

// Mock console.log in tests to reduce noise
// global.console = {
//   ...console,
//   log: jest.fn(),
//   warn: jest.fn(),
// };

