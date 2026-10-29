type PlaceholderPageProps = {
  title: string;
  /** The task that builds this screen, e.g. "C-2". */
  task: string;
};

/** Stand-in for routes whose screens are built in later tasks. */
export function PlaceholderPage({ title, task }: PlaceholderPageProps) {
  return (
    <div className="mx-auto w-full max-w-300 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-[-0.03em]">{title}</h1>
      <p className="mt-2 text-muted-foreground">Coming in {task}.</p>
    </div>
  );
}
