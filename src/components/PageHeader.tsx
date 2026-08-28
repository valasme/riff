/** The card's header band. One `<h1>` per screen, which is also what the
 *  route announcer's live region is describing. */
export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="border-b border-separator px-6 py-4">
      <h1 className="text-base font-semibold">{title}</h1>
      {description && <p className="mt-1 text-[0.8125rem] text-muted-foreground">{description}</p>}
    </header>
  );
}
