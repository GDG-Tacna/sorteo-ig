import { describe, expect, it } from "vitest";
import {
  buildCompletenessWarning,
  deduplicateParticipants,
  parseInstagramPostUrl,
  parseManualCommentsInput,
  pickTwoWinners,
  type RawComment,
} from "./giveaway";

describe("parseInstagramPostUrl", () => {
  it("normalizes standard post, reel, and profile-scoped URLs", () => {
    expect(
      parseInstagramPostUrl("https://www.instagram.com/p/C8abc_123/?igsh=xyz")
    ).toEqual({
      isValid: true,
      normalizedUrl: "https://www.instagram.com/p/C8abc_123/",
      shortcode: "C8abc_123",
      kind: "p",
    });

    expect(
      parseInstagramPostUrl("instagram.com/codinglatam/reel/D1xyz-987/")
    ).toEqual({
      isValid: true,
      normalizedUrl: "https://www.instagram.com/reel/D1xyz-987/",
      shortcode: "D1xyz-987",
      kind: "reel",
    });
  });

  it("rejects non-Instagram or profile-only URLs", () => {
    expect(parseInstagramPostUrl("https://google.com/p/abc12345").isValid).toBe(
      false
    );
    expect(
      parseInstagramPostUrl("https://www.instagram.com/codinglatam/").isValid
    ).toBe(false);
  });
});

describe("deduplicateParticipants", () => {
  it("counts each person strictly once even if they commented multiple times", () => {
    const comments: RawComment[] = [
      { id: "1", username: "Ana.Dev", text: "Comentario 1" },
      { id: "2", username: "@ana.dev", text: "Comentario 2" },
      { id: "3", username: "ANA.DEV", text: "Comentario 3" },
      { id: "4", username: "carlos_ux", text: "Participo" },
      { id: "5", username: "luisa.pm", text: "Yo también" },
    ];

    const unique = deduplicateParticipants(comments);
    expect(unique).toHaveLength(3);

    const ana = unique.find((p) => p.normalizedUsername === "ana.dev");
    expect(ana?.commentCount).toBe(3);
    expect(ana?.comments).toHaveLength(3);
  });

  it("excludes post owner when excludeUsername is provided", () => {
    const comments: RawComment[] = [
      { id: "1", username: "host_account", text: "¡Gracias por participar!" },
      { id: "2", username: "user_one", text: "Participo" },
      { id: "3", username: "user_two", text: "Vamos" },
    ];

    const unique = deduplicateParticipants(comments, {
      excludeUsername: "@Host_Account",
    });
    expect(unique.map((u) => u.normalizedUsername)).toEqual([
      "user_one",
      "user_two",
    ]);
  });
});

describe("pickTwoWinners", () => {
  it("always returns 2 distinct users across N draws and respects single-entry fairness", () => {
    // Even if spammer commented 50 times, after deduplicateParticipants they only have 1 entry
    const comments: RawComment[] = [
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `s-${i}`,
        username: "spammer_user",
        text: `Intento #${i}`,
      })),
      { id: "u2", username: "maria.code", text: "Hola!" },
      { id: "u3", username: "pedro.js", text: "Participo!" },
      { id: "u4", username: "lucia.ai", text: "Éxitos!" },
    ];

    const participants = deduplicateParticipants(comments);
    expect(participants).toHaveLength(4);

    for (let round = 0; round < 50; round++) {
      const { winners } = pickTwoWinners(participants);
      expect(winners).toHaveLength(2);
      expect(winners[0].normalizedUsername).not.toBe(
        winners[1].normalizedUsername
      );
    }
  });

  it("throws when fewer than 2 unique participants are eligible", () => {
    const participants = deduplicateParticipants([
      { id: "1", username: "solo_uno", text: "Primero" },
      { id: "2", username: "solo_uno", text: "Segundo del mismo usuario" },
    ]);

    expect(() => pickTwoWinners(participants)).toThrow(/al menos 2/);
  });
});

describe("buildCompletenessWarning", () => {
  it("warns when fewer comments were read than Instagram reports", () => {
    expect(
      buildCompletenessWarning({
        readCount: 40,
        expectedCount: 120,
        sessionConnected: true,
      })
    ).toMatch(/40 de los 120/);
  });

  it("warns when there is no session, even without an expected count", () => {
    expect(
      buildCompletenessWarning({ readCount: 12, sessionConnected: false })
    ).toMatch(/Sin sesión/);
  });

  it("asks to connect when the list is short and there is no session", () => {
    const warning = buildCompletenessWarning({
      readCount: 12,
      expectedCount: 57,
      sessionConnected: false,
    });
    expect(warning).toMatch(/12 de los 57/);
    expect(warning).toMatch(/Conecta Instagram/);
  });

  it("stays silent when the list is complete or empty", () => {
    expect(
      buildCompletenessWarning({
        readCount: 120,
        expectedCount: 120,
        sessionConnected: true,
      })
    ).toBeUndefined();
    expect(
      buildCompletenessWarning({ readCount: 0, sessionConnected: false })
    ).toBeUndefined();
  });
});

describe("parseManualCommentsInput", () => {
  it("parses line-based @username: comment entries", () => {
    const parsed = parseManualCommentsInput(
      `@juan.dev: Quiero participar\nmaria_ux - Excelente post\n@juan.dev: Otro comentario`
    );
    expect(parsed).toHaveLength(3);
    expect(deduplicateParticipants(parsed)).toHaveLength(2);
  });
});
