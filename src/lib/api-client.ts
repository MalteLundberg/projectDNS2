export class ApiRequestError extends Error {
  code?: string;
  details?: unknown;
  status: number;

  constructor(message: string, input: { status: number; code?: string; details?: unknown }) {
    super(message);
    this.name = "ApiRequestError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}

export function formatErrorDetails(details: unknown) {
  if (details == null) {
    return "";
  }

  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    const parts = [error.message];

    if (error.code) {
      parts.push(`Code: ${error.code}`);
    }

    const formattedDetails = formatErrorDetails(error.details);

    if (formattedDetails) {
      parts.push(`Details: ${formattedDetails}`);
    }

    return parts.join("\n");
  }

  return error instanceof Error ? error.message : "Unknown error";
}

export function splitErrorMessageParts(message: string | undefined) {
  const lines = (message ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const [firstLine = ""] = lines;
  const codeLine = lines.find((line) => line.startsWith("Code: "));
  const detailsStartIndex = lines.findIndex((line) => line.startsWith("Details: "));
  const detailsLines =
    detailsStartIndex === -1
      ? []
      : [
          lines[detailsStartIndex].slice("Details: ".length),
          ...lines.slice(detailsStartIndex + 1),
        ];

  return {
    message: firstLine,
    code: codeLine ? codeLine.slice("Code: ".length) : "",
    details: detailsLines.join("\n").trim(),
  };
}

export async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
  });
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`Expected JSON but received: ${text.slice(0, 120)}`);
  }

  const data = (await response.json()) as T & {
    error?: string;
    ok?: boolean;
    code?: string;
    details?: unknown;
  };

  if (!response.ok || data.ok === false) {
    throw new ApiRequestError(data.error ?? `Request failed with status ${response.status}`, {
      status: response.status,
      code: data.code,
      details: data.details,
    });
  }

  return data;
}
