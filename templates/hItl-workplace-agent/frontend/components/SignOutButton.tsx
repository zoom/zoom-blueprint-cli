"use client";
import { useState } from "react";
export function SignOutButton() {
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="inline-flex items-center rounded border border-ink-300 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
        onClick={async () => {
          try {
            const res = await fetch("/auth/logout", {
              method: "POST",
              headers: { "X-Zoom-Requested-With": "zoom-blueprint" },
              credentials: "include",
            });
            if (!res.ok) throw new Error("Sign out failed. Try again.");
            window.location.assign("/install");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Sign out
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
