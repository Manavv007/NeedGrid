import { LogoMark } from "@/components/LogoMark";

/** Shown instead of the app when the public build config (VITE_*) is unusable. */
export function ConfigErrorScreen({ problems }: { problems: string[] }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <section
        role="alert"
        className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border bg-surface p-6"
        aria-labelledby="config-error-title"
      >
        <LogoMark />
        <h1 id="config-error-title" className="text-xl font-extrabold">
          NeedGrid isn't configured
        </h1>
        <p className="text-sm leading-normal text-soft">
          This build is missing settings it needs to reach the API. If you run this site, fix these in the web app's
          environment and rebuild:
        </p>
        <ul className="list-disc space-y-1 pl-5 font-mono text-[13px] text-foreground">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
