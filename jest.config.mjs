export default {
  projects: [
    '.',
    '<rootDir>/packages/*',
  ],
  moduleNameMapper: {
    '^@post-machine-js/machine$': '<rootDir>/packages/machine/src',
    '^@turing-machine-js/machine$': '<rootDir>/node_modules/@turing-machine-js/machine/dist/index.js',
  },
  moduleDirectories: ['node_modules'],
  transformIgnorePatterns: [
    'node_modules/(?!@post-machine-js|@turing-machine-js)',
  ],
};
