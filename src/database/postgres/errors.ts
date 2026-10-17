const KNOWN_CODES: Record<string, string> = {
  ECONNREFUSED: "Connection refused. Is PostgreSQL running, and are the host and port in DATABASE_URL correct?",
  ENOTFOUND: "Host not found. Check the host name in DATABASE_URL.",
  ETIMEDOUT: "Connection timed out. Check the host, port and network.",
  "28P01": "Wrong username or password in DATABASE_URL.",
  "28000": "This user is not allowed to connect. Check the user and database in DATABASE_URL.",
  "3D000": "That database does not exist. Check the database name in DATABASE_URL.",
  "42501": "Permission denied. This database user cannot read that table.",
  "42P01": "That table does not exist.",
  "57014": "The query took too long and was cancelled.",
};

export function explainError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const code = (error as { code?: string }).code;

  if (code && KNOWN_CODES[code]) {
    return KNOWN_CODES[code];
  }

  if (error.message.includes("timeout exceeded when trying to connect")) {
    return KNOWN_CODES["ETIMEDOUT"] as string;
  }

  return error.message || "Unknown error.";
}
