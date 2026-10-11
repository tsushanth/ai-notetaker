// Gives every Claude call made inside the named methods a feature label for the spend breakdown, without touching each call site.
// Methods on one service call each other through `this`, so a nested label simply repeats the same name.
function labelMethods(target, map, withFeature) {
  for (const [name, feature] of Object.entries(map)) {
    const orig = target[name];
    if (typeof orig !== 'function') continue;
    target[name] = function labelled(...args) { return withFeature(feature, () => orig.apply(this, args)); };
  }
  return target;
}

module.exports = { labelMethods };
