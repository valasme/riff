/** The heading band at the top of a screen. One `<h1>` per screen, which is
 *  also what the route announcer's live region is describing. */
export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-[var(--section-gap)] border-b border-line pb-4">
      <h1 className="text-lg leading-tight font-semibold">{title}</h1>
      {description && (
        <p className="mt-1 max-w-prose text-[0.8125rem] text-muted-foreground">{description}</p>
      )}
    </header>
  );
}
