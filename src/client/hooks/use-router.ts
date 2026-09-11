import { useState, useEffect, useCallback } from "preact/hooks";

export function useRouter() {
  const [path, setPath] = useState(window.location.pathname);

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, "", to);
    setPath(to);
  }, []);

  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Parse /design/:id and /export/:id
  const designMatch = path.match(/^\/design\/([^/]+)$/);
  const exportMatch = path.match(/^\/export\/([^/]+)$/);
  const designId = designMatch ? designMatch[1] : null;
  const exportDesignId = exportMatch ? exportMatch[1] : null;

  return { path, navigate, designId, exportDesignId };
}
