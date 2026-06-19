import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-md w-full text-center">
        <div className="text-5xl font-black text-gray-200 mb-4">404</div>
        <h1 className="text-base font-semibold text-gray-900 mb-2">Page not found</h1>
        <p className="text-sm text-gray-500 mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <button
          onClick={() => setLocation(`${base}/`)}
          className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "#4F35A8" }}
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
