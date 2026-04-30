import { rollup } from 'rollup';

const packages = [
  {
    name: '@post-machine-js/machine',
    entry: 'packages/machine/dist/index.js',
    outputs: {
      esm: 'packages/machine/dist/index.mjs',
      cjs: 'packages/machine/dist/index.cjs',
    },
    external: [
      '@turing-machine-js/machine',
    ],
  },
];

for (const pkg of packages) {
  const bundle = await rollup({
    input: pkg.entry,
    external: pkg.external,
  });

  await bundle.write({
    file: pkg.outputs.esm,
    format: 'es',
    exports: 'auto',
  });

  await bundle.write({
    file: pkg.outputs.cjs,
    format: 'cjs',
    exports: 'auto',
  });

  await bundle.close();

  console.log(`Built ${pkg.name} Node entries.`);
}
