/**
 * Shared helpers for the /api route handlers. Each domain router (meetings,
 * tasks, suggestions, ai, …) imports what it needs from here.
 */

/** Activity actors come only from the verified operator session. */
export function actorFrom(req) {
  return req.operator.id;
}

/** Standard 404 response shape used by every domain router. */
export function notFound(res, what) {
  return res.status(404).json({ success: false, error: `${what} not found` });
}
