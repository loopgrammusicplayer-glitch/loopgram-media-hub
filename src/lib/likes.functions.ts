import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const videoLike = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid(), sk: z.string().min(1).max(200), token: z.string().min(10).max(8192), mode: z.enum(["write", "read", "unlike", "dislike", "undislike"]) }).strict().parse(data))
  .handler(async ({ data }) => {
    const { likeAction } = await import("./likes.server");
    return likeAction(data);
  });