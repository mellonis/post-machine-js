const moduleName = 'machine';

module.exports = {
  name: moduleName,
  displayName: moduleName,
  transformIgnorePatterns: [
    'node_modules/(?!@turing-machine-js)',
  ],
};
