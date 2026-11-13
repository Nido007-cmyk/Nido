// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

// Babel config for Jest component tests.
// Uses @react-native/babel-preset to handle Flow types and RN syntax.
// Only used by Jest; Vitest and Expo builds are unaffected.
//
// 0.1.90: under babel-jest (and only there — gated on the caller, so
// Metro/Expo transforms are byte-identical to before), dynamic
// import() is rewritten to Promise.resolve().then(() => require()).
// Without it, a component whose mount path loads a module lazily
// (SourceReader: import("../../rag/packs") in its effect) cannot be
// tested at all: Node's jest runtime has no VM modules here, so the
// bare import() throws "A dynamic import callback was invoked without
// --experimental-vm-modules" and the component lands in its error
// state no matter what jest.mock provides. With the rewrite, the
// lazy load resolves through the normal (mockable) require path,
// exactly as Metro's own lazy require behaves on device.
function dynamicImportForJest({ types: t }) {
  return {
    name: "nido-jest-dynamic-import",
    visitor: {
      CallExpression(path) {
        if (path.node.callee.type !== "Import") return;
        const source = path.node.arguments[0];
        const lazyRequire = t.callExpression(t.identifier("require"), [source]);
        const resolved = t.callExpression(
          t.memberExpression(
            t.callExpression(t.memberExpression(t.identifier("Promise"), t.identifier("resolve")), []),
            t.identifier("then"),
          ),
          [t.arrowFunctionExpression([], lazyRequire)],
        );
        path.replaceWith(resolved);
      },
    },
  };
}

module.exports = (api) => {
  // api.caller registers its own cache key on the caller identity.
  const isJest = api.caller((caller) => !!caller && caller.name === "babel-jest");
  return {
    presets: ["@react-native/babel-preset"],
    plugins: isJest ? [dynamicImportForJest] : [],
  };
};
