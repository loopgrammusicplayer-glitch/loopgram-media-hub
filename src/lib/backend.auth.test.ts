import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "test-jwks"),
  jwtVerify: vi.fn(async () => ({ payload: { sub: "owner-test-uid", email: "owner@example.test" } })),
}));

import { jwtVerify } from "jose";
import { verifyUser } from "./backend.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Firebase account verification", () => {
  it("verifies against loopgram-channel when the optional project setting is absent", async () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("OWNER_UID", "owner-test-uid");
    const result = await verifyUser("test-token");
    expect(jwtVerify).toHaveBeenCalledWith("test-token", "test-jwks", {
      issuer: "https://securetoken.google.com/loopgram-channel",
      audience: "loopgram-channel",
    });
    expect(result.role).toBe("owner");
  });

  it("honors an explicit Firebase project override", async () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", " alternate-project ");
    vi.stubEnv("OWNER_UID", "owner-test-uid");
    await verifyUser("test-token");
    expect(jwtVerify).toHaveBeenCalledWith("test-token", "test-jwks", {
      issuer: "https://securetoken.google.com/alternate-project",
      audience: "alternate-project",
    });
  });

  it("rejects requests without a Firebase token", async () => {
    await expect(verifyUser(undefined)).rejects.toThrow("Not signed in");
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("does not grant owner access to another verified user", async () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("OWNER_UID", "different-owner-uid");
    expect((await verifyUser("test-token")).role).toBe("user");
  });
});