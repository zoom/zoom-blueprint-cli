/** Validate only editable task fields. Identity, provenance and approval fields are server-owned. */
export function taskUpdates(
  input,
  { allowStatus = true, allowEmpty = false } = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected an object of editable task fields.");
  const allowed = [
    "title",
    "description",
    "owner",
    "priority",
    "dueDate",
    ...(allowStatus ? ["status"] : []),
  ];
  const keys = Object.keys(input);
  if (!allowEmpty && !keys.length)
    throw new Error("Supply at least one editable field.");
  if (keys.some((key) => !allowed.includes(key)))
    throw new Error(
      "Unsupported task fields. Only title, description, owner, priority, dueDate and permitted status changes are accepted.",
    );
  const result = {};
  for (const key of keys) {
    const value = input[key];
    if (key === "priority") {
      if (!["Low", "Medium", "High"].includes(value))
        throw new Error("Invalid priority.");
    } else if (key === "status") {
      if (!["open", "in_progress", "completed"].includes(value))
        throw new Error("Invalid status.");
    } else if (key === "dueDate") {
      if (
        value !== null &&
        (typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw new Error("dueDate must be a valid YYYY-MM-DD date or null.");
    } else if (value === null && key === "owner") {
      /* Unassigned is a supported task owner. */
    } else if (
      typeof value !== "string" ||
      (key === "title" && !value.trim()) ||
      value.length > (key === "description" ? 10000 : 256)
    )
      throw new Error(`Invalid ${key}.`);
    result[key] = value;
  }
  return result;
}
