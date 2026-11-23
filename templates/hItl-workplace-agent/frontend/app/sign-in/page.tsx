"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useZoomAppSdk } from "@/lib/use-zoom-app-sdk";
export default function SignIn() {
  const sdk = useZoomAppSdk();
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <main className="mx-auto max-w-xl p-8">
      <section className="rounded-2xl border border-ink-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-zoom-blue">
          Zoom Workplace Agent
        </p>
        <h1 className="mt-3 text-2xl font-semibold">
          Sign in to your workspace
        </h1>
        <p className="mt-3 text-ink-600">
          Authorize with the operator’s Zoom account to view meeting context and
          approve AI suggestions.
        </p>
        {sdk.phase === "ready" ? (
          <button
            className="mt-6 rounded-lg bg-blue-600 px-5 py-3 text-white"
            onClick={async () => {
              try {
                const result = await sdk.startInClientAuth();
                if (!result.ok) throw new Error(result.reason);
                router.push("/");
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Authorize in Zoom
          </button>
        ) : (
          <a
            className="mt-6 inline-block rounded-lg bg-blue-600 px-5 py-3 text-white"
            href="/auth/login"
          >
            Continue with Zoom
          </a>
        )}
        {error && (
          <p role="alert" className="mt-4 text-red-700">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
