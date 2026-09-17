// Note: Footer is NOT included here — it's rendered by ConditionalFooter in root layout
export default function StaticPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-4xl mx-auto px-4 py-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
