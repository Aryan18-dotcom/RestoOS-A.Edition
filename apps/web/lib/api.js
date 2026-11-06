const API_BASE = "/api/v1";

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
    credentials: "include"
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