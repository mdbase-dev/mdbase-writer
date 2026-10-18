// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({
  render: vi.fn(),
  entry: { application: {} },
  create: vi.fn(),
  grantReturn: vi.fn(),
  deliver: vi.fn(async () => {}),
}));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: bootstrap.render }) }));
vi.mock("./App.js", () => ({ App: () => null }));
vi.mock("./FeedbackRoot.js", () => ({ FeedbackRoot: () => null }));
vi.mock("./pwa-install.js", () => ({ setupPwaInstall: () => () => {} }));
vi.mock("./connect/sdk-application.js", () => ({
  writerMdbaseForBuild: bootstrap.create,
  isWriterGrantReturn: bootstrap.grantReturn,
  deliverWriterGrantReturn: bootstrap.deliver,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  bootstrap.create.mockReturnValue(bootstrap.entry);
  bootstrap.grantReturn.mockReturnValue(false);
  document.body.innerHTML = '<div id="root"></div>';
  history.replaceState({}, "", "/?demo");
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_MDBASE_ENV", "lab");
  vi.stubEnv("VITE_WRITER_DEMO", undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("keeps an ordinary LAB demo query on the native entry without an enabled fixture build", async () => {
  await import("./main.js");
  expect(bootstrap.create).toHaveBeenCalledExactlyOnceWith("lab");
  expect(bootstrap.render.mock.calls[0]![0].props.children.props.children.props.sdk).toBe(bootstrap.entry);
});

it("opens the explicit production demo fixture without allocating a native account entry", async () => {
  vi.stubEnv("VITE_WRITER_DEMO", "1");
  await import("./main.js");
  expect(bootstrap.create).not.toHaveBeenCalled();
  expect(bootstrap.render.mock.calls[0]![0].props.children.props.children.props.sdk).toBeUndefined();
});

it("still opens the normal native entry in a fixture-enabled build without the demo query", async () => {
  vi.stubEnv("VITE_WRITER_DEMO", "1");
  history.replaceState({}, "", "/");
  await import("./main.js");
  expect(bootstrap.create).toHaveBeenCalledExactlyOnceWith("lab");
});

it("honors the existing development demo without allocating a native entry", async () => {
  vi.stubEnv("DEV", true);
  await import("./main.js");
  expect(bootstrap.create).not.toHaveBeenCalled();
});

it("delivers a grant return ahead of an explicitly enabled demo and never allocates a second entry", async () => {
  vi.stubEnv("VITE_WRITER_DEMO", "1");
  bootstrap.grantReturn.mockReturnValue(true);
  await import("./main.js");
  expect(bootstrap.deliver).toHaveBeenCalledExactlyOnceWith(location.href);
  expect(bootstrap.create).not.toHaveBeenCalled();
  expect(bootstrap.render.mock.calls[0]![0].props.children.type).toBe("p");
});
