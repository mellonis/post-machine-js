import packageJson from './package.json' with { type: 'json' };

const [organizationName, packageName] = packageJson.name.split('/');

export default {
  displayName: {
    name: packageName,
    color: 'green',
  },
  moduleNameMapper: {
    [`^${packageJson.name}$`]: '<rootDir>/src',
    '^@turing-machine-js/machine$': '<rootDir>/../../node_modules/@turing-machine-js/machine/dist/index.cjs',
  },
  moduleDirectories: ['node_modules', '../../node_modules'],
  transformIgnorePatterns: [
    `node_modules/(?!${organizationName}|@turing-machine-js)`,
  ],
};
