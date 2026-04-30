export default {
  projects: [
    {
      // Root project — README/example tests only. Scoped to test/ so the
      // per-package projects below don't double-execute the same files.
      displayName: { name: 'root', color: 'magenta' },
      rootDir: '.',
      testMatch: ['<rootDir>/test/**/*.spec.ts'],
      moduleNameMapper: {
        '^@post-machine-js/machine$': '<rootDir>/packages/machine/src',
        '^@turing-machine-js/machine$': '<rootDir>/node_modules/@turing-machine-js/machine/dist/index.cjs',
      },
      moduleDirectories: ['node_modules'],
      transformIgnorePatterns: [
        'node_modules/(?!@post-machine-js|@turing-machine-js)',
      ],
    },
    '<rootDir>/packages/*',
  ],
};
