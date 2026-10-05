// Babel config for Jest component tests.
// Uses @react-native/babel-preset to handle Flow types and RN syntax.
// Only used by Jest; Vitest and Expo builds are unaffected.
module.exports = {
  presets: ["@react-native/babel-preset"],
};
