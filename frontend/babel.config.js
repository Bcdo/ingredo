// Jest runs source through Babel into plain CommonJS and executes it with
// Node's vm module, which has no dynamic `import()` callback wired up
// (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG). Metro (dev/prod builds)
// handles `import()` natively, so this plugin is scoped to the test env
// only — it rewrites `import('./x')` to `Promise.resolve().then(() =>
// require('./x'))`, which resolves to the same CJS exports object Metro's
// runtime hands back, so call sites like `(await import('./x')).thing()`
// behave identically either way.
function dynamicImportToRequireForTests({ types: t }) {
  return {
    visitor: {
      CallExpression(path) {
        if (path.node.callee.type !== 'Import') return;
        const requireCall = t.callExpression(t.identifier('require'), path.node.arguments);
        const thenCallback = t.arrowFunctionExpression([], requireCall);
        const resolveCall = t.callExpression(
          t.memberExpression(t.identifier('Promise'), t.identifier('resolve')),
          []
        );
        path.replaceWith(
          t.callExpression(t.memberExpression(resolveCall, t.identifier('then')), [thenCallback])
        );
      },
    },
  };
}

module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV);
  let plugins = [];

  plugins.push('react-native-worklets/plugin');
  plugins.push(['inline-import', { extensions: ['.sql'] }]);

  if (api.env('test')) {
    plugins.push(dynamicImportToRequireForTests);
  }

  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],

    plugins,
  };
};
