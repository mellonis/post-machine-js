const packageInfo = require('./package.json');

const [, packageName] = packageInfo.name.split('/');

module.exports = {
  displayName: {
    name: packageName,
    color: 'yellow',
  },
  moduleNameMapper: {
    [`^${packageInfo.name}`]: '<rootDir>/src',
  },
  transformIgnorePatterns: [
    'node_modules/(?!@turing-machine-js)',
  ],
};
