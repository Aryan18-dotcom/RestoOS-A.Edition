const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => value < 0 || value > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function getApiBase() {
  if (typeof window === "undefined") return API;
  const url = new URL(API);
  if (["localhost", "127.0.0.1"].includes(url.hostname) && isPrivateIpv4(window.location.hostname)) {
    url.hostname = window.location.hostname;
  }
  return url.origin;
}

export async function api(path, options = {}) {
  const response = await fetch(`${getApiBase()}/api/v1${path}`, {
    ...options, credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = response.status; error.code = data.code; throw error;
  }
  return data;
}
