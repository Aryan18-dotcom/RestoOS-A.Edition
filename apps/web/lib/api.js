const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "https://restro-os-aedition-api.vercel.app/api/v1").replace(/\/+$/, "");

export async function api(endpoint, options = {}) {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const config = {
    ...options,
    headers,
    credentials: "include" // REQUIRED: enables cross-domain cookie transmission
  };

  const res = await fetch(url, config);

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const error = new Error(data?.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.code = data?.code;
    error.details = data?.details;
    throw error;
  }

  return data;
}