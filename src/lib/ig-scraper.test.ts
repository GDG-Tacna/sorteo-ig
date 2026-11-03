import { describe, expect, it } from "vitest";
import type { RawComment } from "./giveaway";
import { extractFromIgJson } from "./ig-scraper";

function relatedThenTargetPayload() {
  return {
    related: {
      code: "RELATEDPOST",
      pk: "111",
      comment_count: 999,
      user: { username: "other_author" },
      caption: { pk: "c-111", user: { username: "other_author" } },
    },
    target: {
      code: "TARGETPOST1",
      pk: "222",
      comment_count: 57,
      user: { username: "real_author" },
      caption: { pk: "c-222", user: { username: "real_author" } },
    },
  };
}

describe("extractFromIgJson", () => {
  it("reads post metadata from the target post, not from related posts", () => {
    const meta: Parameters<typeof extractFromIgJson>[2] = {
      shortcode: "TARGETPOST1",
    };

    extractFromIgJson(
      relatedThenTargetPayload(),
      new Map<string, RawComment>(),
      meta
    );

    expect(meta.mediaId).toBe("222");
    expect(meta.ownerUsername).toBe("real_author");
    expect(meta.expectedCount).toBe(57);
  });

  it("collects comments and skips the caption", () => {
    const collected = new Map<string, RawComment>();

    extractFromIgJson(
      {
        code: "TARGETPOST1",
        caption: {
          pk: "c-222",
          text: "Texto del post",
          created_at: 1,
          user: { username: "real_author" },
        },
        comments: [
          { pk: "1", text: "Participo", user: { username: "ana.dev" } },
          { pk: "2", text: "Yo también", user: { username: "luis_ux" } },
        ],
      },
      collected,
      { shortcode: "TARGETPOST1" }
    );

    expect(Array.from(collected.values()).map((c) => c.username)).toEqual([
      "ana.dev",
      "luis_ux",
    ]);
  });
});
