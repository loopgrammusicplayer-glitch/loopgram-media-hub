import { describe, expect, it } from "vitest";
import { firebaseWebConfig } from "./firebase-config.core";

describe("Firebase web configuration", () => {
  it("uses the supplied public web key when no server override exists", () => {
    expect(firebaseWebConfig().apiKey).toBe("AIzaSyCzl8Aw89zRLVgFpUAkSL1WlB7m_6CcObw");
    expect(firebaseWebConfig("  ").apiKey).toBe(firebaseWebConfig().apiKey);
    expect(firebaseWebConfig().projectId).toBe("loopgram-channel");
  });
  it("honors an explicit web key override", () => {
    expect(firebaseWebConfig("  configured-web-key  ").apiKey).toBe("configured-web-key");
  });
});