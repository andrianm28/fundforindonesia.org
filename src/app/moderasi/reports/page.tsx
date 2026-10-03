export default function ReportsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      {/* Icon */}
      <div className="w-16 h-16 rounded-full bg-[#FFEBEE] flex items-center justify-center mb-4">
        <svg
          className="w-8 h-8 text-[#F44336]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
      </div>

      <h1 className="text-xl font-semibold text-text">Laporan</h1>
      <p className="text-sm text-text-secondary mt-2 max-w-sm">
        Fitur laporan akan segera hadir. Anda akan dapat mengelola laporan dari
        pengguna di sini.
      </p>
    </div>
  );
}
