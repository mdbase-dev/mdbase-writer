import { i18nConfig } from "@mdbase-dev/i18n/config";

export default i18nConfig({
  include: ["<rootDir>/src"],
  exclude: ["**/*.test.*", "**/test/**"],
  runtimeConfigModule: { i18n: ["@writer/i18n", "i18n"] },
});
