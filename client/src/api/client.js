import axios from 'axios';

/** The deployed API, used when no override is supplied at build time. */
const PRODUCTION_API = 'https://mid-day-meal-ze1a.vercel.app';

/**
 * Where the API lives depends on how the bundle was built:
 *
 *   VITE_API_URL set   → that origin wins, so a different backend can be
 *                        pointed at without touching the code
 *   development build  → empty, letting Vite proxy /api to localhost:5000
 *   production build   → the deployed API above
 *
 * The production fallback matters because a build with no environment
 * variable would otherwise look for the API on the site's own domain, where
 * it does not exist.
 */
const resolveApiRoot = () => {
  const override = (import.meta.env.VITE_API_URL || '').trim();
  if (override) return override.replace(/\/$/, '');
  return import.meta.env.DEV ? '' : PRODUCTION_API;
};

const API_ROOT = resolveApiRoot();
const api = axios.create({ baseURL: API_ROOT ? `${API_ROOT}/api` : '/api' });

// Every request carries the saved token.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A dead session sends the user back to the login screen once.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.startsWith('/login')) {
      localStorage.removeItem('vp_token');
      localStorage.removeItem('vp_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/** Pulls a readable message out of an ApiError response. */
export const errorText = (err) => {
  const d = err.response?.data;
  if (!d) return err.message || 'Something went wrong.';
  if (d.details?.length) return d.details.map((x) => x.message).join(' · ');
  return d.message || 'Request failed.';
};

/** Absolute URL for a file served by the API, e.g. a bill attachment. */
export const fileUrl = (path) => (API_ROOT ? `${API_ROOT}/api${path}` : `/api${path}`);

/** Triggers a browser download for an .xlsx endpoint. */
export const downloadFile = async (url, params) => {
  const res = await api.get(url, { params, responseType: 'blob' });
  const cd = res.headers['content-disposition'] || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || 'download.xlsx';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(res.data);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
  return name;
};

export default api;
