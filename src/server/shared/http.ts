import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Unauthorized, Forbidden, NotFound } from "./authorize";
import { IllegalTransition } from "./state-machine";
import { LeakCheckError } from "./leak-check";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap every route handler: maps domain errors to HTTP codes so no raw 500s leak stack traces. */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof Unauthorized) return NextResponse.json({ error: "E_UNAUTHORIZED" }, { status: 401 });
      if (e instanceof Forbidden) return NextResponse.json({ error: "E_FORBIDDEN" }, { status: 403 });
      if (e instanceof NotFound) return NextResponse.json({ error: "E_NOT_FOUND" }, { status: 404 });
      if (e instanceof ZodError) return NextResponse.json({ error: "E_VALIDATION", issues: e.issues }, { status: 400 });
      if (e instanceof IllegalTransition) return NextResponse.json({ error: e.code, from: e.from, to: e.to }, { status: 409 });
      if (e instanceof LeakCheckError) return NextResponse.json({ error: e.code, hits: e.hits }, { status: 422 });
      console.error(e);
      return NextResponse.json({ error: "E_INTERNAL" }, { status: 500 });
    }
  };
}

/** Server-action result envelope (ARCHITECTURE §9). Never throw across the action boundary except redirect(). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; errors?: Record<string, string>; hits?: LeakCheckError["hits"] };

export function toActionError(e: unknown): ActionResult<never> {
  if (e instanceof ZodError) {
    const errors: Record<string, string> = {};
    for (const i of e.issues) errors[i.path.join(".") || "_"] = i.message;
    return { ok: false, error: "E_VALIDATION", errors };
  }
  if (e instanceof LeakCheckError) return { ok: false, error: e.code, hits: e.hits };
  if (e instanceof IllegalTransition) return { ok: false, error: e.code };
  if (e instanceof Unauthorized || e instanceof Forbidden || e instanceof NotFound) return { ok: false, error: e.code };
  console.error(e);
  return { ok: false, error: "E_INTERNAL" };
}
