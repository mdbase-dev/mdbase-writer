// Non-React presentation helpers use the same real, synchronous English runtime.
import "../i18n/app.js";

if (typeof Element !== "undefined") {
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
}
