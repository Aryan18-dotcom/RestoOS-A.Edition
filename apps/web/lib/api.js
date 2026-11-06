// Resolves base API URL, trimming trailing slashes.
// Defaults to the local server if running locally, otherwise the production Vercel API.
const isDev = process.env.NODE_ENV === "development";
const fallbackUrl = isDev 
  ? "http://localhost:5000/api/v1" 
  : "https://restro-os-aedition-api.vercel.app/api/v1";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || fallbackUrl).replace(/\/+$/, "");

export async function api(endpoint, options = {}) {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  // Automatically handle headers without overriding FormData boundary
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {})
  };

  const config = {
    ...options,
    headers,
    credentials: "include" // REQUIRED: enables cross-domain cookie transmission
  };

  const res = await fetch(url, config);

  // Handle 204 No Content or responses without a body
  if (res.status === 204) {
    return null;
  }

  let data = null;
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
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