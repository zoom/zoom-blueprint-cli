// Server components forward only the current request's session cookie.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createApi } from "./api-client";
export const api = createApi(
  async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const cookie = (await cookies()).toString();
    const origin =
      process.env.PUBLIC_BASE_URL ||
      process.env.FRONTEND_ORIGIN ||
      `http://localhost:${process.env.FRONTEND_PORT || 3000}`;
    const res = await fetch(
      (process.env.EXPRESS_ORIGIN || "http://localhost:4000") + path,
      {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
          "X-Zoom-Requested-With": "zoom-blueprint",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      },
    );
    if (res.status === 401) redirect("/sign-in");
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
    return res.json();
  },
);
