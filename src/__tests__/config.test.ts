import { describe, expect, it } from "bun:test";

describe("config", () => {
  it("uses defaults when env vars absent", () => {
    delete process.env.COGWORKS_PORT;
    delete process.env.COGWORKS_DATA_DIR;
    const config = {
      port: parseInt(process.env.COGWORKS_PORT ?? "8090", 10),
      dataDir: process.env.COGWORKS_DATA_DIR ?? "./cogworks_data",
    };
    expect(config.port).toBe(8090);
    expect(config.dataDir).toBe("./cogworks_data");
  });

  it("reads port from env", () => {
    process.env.COGWORKS_PORT = "9000";
    const port = parseInt(process.env.COGWORKS_PORT ?? "8090", 10);
    expect(port).toBe(9000);
    delete process.env.COGWORKS_PORT;
  });
});
