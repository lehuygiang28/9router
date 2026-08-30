import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { applyListenEnv } = require("../../custom-server.js");

function argvWith(...flags) {
  return ["node", "custom-server.js", ...flags];
}

describe("custom-server listen env (Render / PaaS)", () => {
  it("lets PORT override a hardcoded --port flag", () => {
    const argv = argvWith("--port", "20127");
    const env = { PORT: "10000" };
    applyListenEnv(argv, env);
    expect(argv).toEqual(["node", "custom-server.js", "--port", "10000"]);
    expect(env.PORT).toBe("10000");
  });

  it("copies --port onto PORT so the standalone server.js agrees", () => {
    const argv = argvWith("--port", "20127");
    const env = {};
    applyListenEnv(argv, env);
    expect(argv).toEqual(["node", "custom-server.js", "--port", "20127"]);
    expect(env.PORT).toBe("20127");
  });

  it("replaces -p as well as --port", () => {
    const argv = argvWith("-p", "20127");
    applyListenEnv(argv, { PORT: "8080" });
    expect(argv.includes("-p")).toBe(false);
    expect(argv.slice(-2)).toEqual(["--port", "8080"]);
  });

  it("injects HOSTNAME as --hostname when the flag is missing", () => {
    const argv = argvWith("--port", "20127");
    const env = { PORT: "10000", HOSTNAME: "0.0.0.0" };
    applyListenEnv(argv, env);
    expect(argv).toEqual(["node", "custom-server.js", "--port", "10000", "--hostname", "0.0.0.0"]);
  });

  it("does not invent a port when neither PORT nor --port is set", () => {
    const argv = argvWith();
    const env = {};
    applyListenEnv(argv, env);
    expect(argv).toEqual(["node", "custom-server.js"]);
    expect(env.PORT).toBeUndefined();
  });
});
