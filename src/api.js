// Cloudflare Worker API url
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

/**
 * Gets or generates a unique Device ID for the browser/session.
 * Persists it in localStorage so the user is consistently recognized on this device.
 */
export function getDeviceId() {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('vat_device_id');
  if (!id) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      id = `dev-${crypto.randomUUID()}`;
    } else {
      // Robust fallback generator if crypto.randomUUID is not available (e.g. non-HTTPS local dev)
      const rand = Math.random().toString(36).substring(2, 11);
      const timestamp = Date.now().toString(36);
      id = `dev-${rand}-${timestamp}`;
    }
    try {
      localStorage.setItem('vat_device_id', id);
    } catch (err) {
      /* ignore storage block */
    }
  }
  return id;
}

/**
 * Fetches the user profile and best scores from Cloudflare R2 via the Worker backend.
 * Returns null if the fetch fails.
 */
export async function fetchProfile(deviceId) {
  if (!deviceId) return null;
  try {
    const res = await fetch(`${API_URL}/api/profile?deviceId=${deviceId}`);
    if (res.ok) {
      const json = await res.json();
      return json.success ? json.data : null;
    }
  } catch (err) {
    console.warn('[API] Could not fetch profile from Cloudflare R2:', err.message);
  }
  return null;
}

/**
 * Synchronizes the local profile details (name and high scores) to R2 storage.
 */
export async function saveProfile(deviceId, name, best) {
  if (!deviceId) return;
  try {
    const res = await fetch(`${API_URL}/api/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId, name, best }),
    });
    if (!res.ok) {
      console.warn('[API] Worker responded with status:', res.status);
    }
  } catch (err) {
    console.warn('[API] Could not sync profile to Cloudflare R2:', err.message);
  }
}
