const LANDING_URL = import.meta.env.BASE_URL
  ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/sales-war-machine\/?$/, "")}/mysa-landing/`
  : `${window.location.origin}/mysa-landing/`;

export default function LandingPreview() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <div>
          <div className="text-sm font-semibold text-gray-900">Mysa AI — Landing Page</div>
          <div className="text-xs text-gray-400 mt-0.5">Live preview of your public-facing marketing site</div>
        </div>
        <a
          href={LANDING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
          style={{ background: "#4F35A8" }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Open in new tab
        </a>
      </div>
      <iframe
        src={LANDING_URL}
        className="flex-1 w-full border-0"
        title="Mysa AI Landing Page"
      />
    </div>
  );
}
