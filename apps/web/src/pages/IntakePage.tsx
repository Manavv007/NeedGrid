import type { IntakeReq } from "@needgrid/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { errorMessage } from "@/features/staff/errorMessage";
import {
  buildPublishRequest,
  isIncluded,
  rowFromDraft,
  withChanges,
  type DraftRow,
} from "@/features/staff/intake/draftRows";
import { IntakeAnalysing } from "@/features/staff/intake/IntakeAnalysing";
import { intakeErrorMessage, NO_ITEMS_MESSAGE } from "@/features/staff/intake/intakeErrors";
import { IntakePublish, type PublishItem } from "@/features/staff/intake/IntakePublish";
import { IntakeReview } from "@/features/staff/intake/IntakeReview";
import { IntakeStart, type StartProblem } from "@/features/staff/intake/IntakeStart";
import { LeaveDraftsDialog } from "@/features/staff/intake/LeaveDraftsDialog";
import { useStaffOrg } from "@/features/staff/useStaffOrg";
import { photoUploadAvailable, uploadImage } from "@/lib/cloudinary";
import { useIntake, usePublishNeed } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const PAGE = "mx-auto w-full max-w-250 px-4 pt-6 sm:px-6";
const PUBLISH_FAILED = "Couldn't save. The server didn't answer.";

type IntakeInput = { kind: "photo"; file: File } | { kind: "text"; text: string };

type Stage =
  | { kind: "start" }
  | { kind: "analysing"; phase: "uploading" | "reading"; uploadPercent: number }
  | { kind: "review" }
  | { kind: "publishing"; publish: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A local preview of the chosen photo (jsdom and old browsers may not have object URLs). */
function previewOf(file: File): string | null {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
}

/**
 * `/staff/intake` (brief A9.8): photo or list → AI drafts → review → publish. Nothing is saved until
 * staff press Publish or Save as drafts; until then the drafts live only in this component.
 */
export function IntakePage() {
  const org = useStaffOrg();
  useDocumentTitle(`Add needs · ${org.name} · NeedGrid staff`);
  const intake = useIntake();
  const publishNeed = usePublishNeed();

  const [stage, setStage] = useState<Stage>({ kind: "start" });
  const [visitedOtherStage, setVisitedOtherStage] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<StartProblem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [items, setItems] = useState<PublishItem[]>([]);

  const lastInput = useRef<IntakeInput | null>(null);
  const analysing = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const cancelledByUser = useRef(false);
  const publishStarted = useRef(false);
  const saving = useRef(new Set<string>());
  const left = useRef(false);

  // Leaving the page stops an intake that is still running and any publishing not yet started (staff
  // chose to discard those). Set again on mount because StrictMode runs this cleanup once in dev.
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
      abort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (previewUrl === null) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function goTo(next: Stage) {
    setStage(next);
    setVisitedOtherStage(true);
  }

  async function analyse(input: IntakeInput) {
    if (analysing.current) return;
    analysing.current = true;
    lastInput.current = input;
    cancelledByUser.current = false;
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null);

    try {
      let req: IntakeReq;
      if (input.kind === "photo") {
        goTo({ kind: "analysing", phase: "uploading", uploadPercent: 0 });
        const imageUrl = await uploadImage(input.file, {
          signal: controller.signal,
          onProgress: (uploadPercent) =>
            setStage((s) => (s.kind === "analysing" && s.phase === "uploading" ? { ...s, uploadPercent } : s)),
        });
        req = { imageUrl };
      } else {
        req = { text: input.text };
      }
      goTo({ kind: "analysing", phase: "reading", uploadPercent: 100 });

      const result = await intake.mutateAsync({ req, signal: controller.signal });
      if (result.drafts.length === 0) {
        const message = result.warnings[0] ?? NO_ITEMS_MESSAGE;
        setProblem({ message, canRetry: false });
        goTo({ kind: "start" });
        toast.error(message);
        return;
      }
      setRows(result.drafts.map(rowFromDraft));
      setWarnings(result.warnings);
      goTo({ kind: "review" });
      toast.success(`We found ${plural(result.drafts.length, "item", "items")}. Check them before you publish.`);
    } catch (error) {
      if (controller.signal.aborted) {
        if (!cancelledByUser.current) return; // the page is going away
        goTo({ kind: "start" });
        toast("Cancelled. Nothing was saved.");
        return;
      }
      const message = intakeErrorMessage(error);
      setProblem({ message, canRetry: true });
      goTo({ kind: "start" });
      toast.error(message);
    } finally {
      analysing.current = false;
      if (abort.current === controller) abort.current = null;
    }
  }

  function onPhoto(file: File) {
    setPreviewUrl(previewOf(file));
    void analyse({ kind: "photo", file });
  }

  function onText(listText: string) {
    setPreviewUrl(null);
    void analyse({ kind: "text", text: listText });
  }

  function cancel() {
    cancelledByUser.current = true;
    abort.current?.abort();
  }

  function retry() {
    if (lastInput.current) void analyse(lastInput.current);
  }

  function changeRow(id: string, changes: Partial<Omit<DraftRow, "id">>) {
    setRows((current) => current.map((row) => (row.id === id ? withChanges(row, changes) : row)));
  }

  function replaceRow(next: DraftRow) {
    setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
  }

  function setItem(id: string, changes: Partial<PublishItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  /** One `POST /api/staff/needs`, never two at once for the same row. Returns whether it saved. */
  async function saveRow(row: DraftRow, publish: boolean): Promise<boolean> {
    if (saving.current.has(row.id)) return false;
    saving.current.add(row.id);
    setItem(row.id, { status: "saving", message: null });
    try {
      await publishNeed.mutateAsync(buildPublishRequest(row, publish));
      setItem(row.id, { status: "done", message: null });
      return true;
    } catch (error) {
      setItem(row.id, { status: "failed", message: errorMessage(error, PUBLISH_FAILED) });
      return false;
    } finally {
      saving.current.delete(row.id);
    }
  }

  /** Publish or save the ticked rows, one after another. Only ever started by a button press. */
  async function submit(publish: boolean) {
    if (publishStarted.current) return;
    const chosen = rows.filter(isIncluded);
    if (chosen.length === 0) return;
    publishStarted.current = true;
    setItems(chosen.map((row) => ({ id: row.id, title: row.title.trim(), status: "waiting", message: null })));
    goTo({ kind: "publishing", publish });

    let failed = 0;
    for (const row of chosen) {
      if (left.current) return;
      if (!(await saveRow(row, publish))) failed += 1;
    }
    const saved = chosen.length - failed;
    if (failed === 0) {
      toast.success(
        publish ? `${plural(saved, "need is", "needs are")} live.` : `${plural(saved, "draft", "drafts")} saved.`,
      );
    } else {
      toast.error(`${plural(failed, "item", "items")} couldn't be saved. Retry below.`);
    }
  }

  async function retryRow(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row || stage.kind !== "publishing") return;
    if (await saveRow(row, stage.publish)) {
      toast.success(stage.publish ? `${row.title.trim()} is live.` : `${row.title.trim()} saved as a draft.`);
    } else {
      toast.error(`${row.title.trim()} still couldn't be saved.`);
    }
  }

  function addMore() {
    publishStarted.current = false;
    lastInput.current = null;
    setRows([]);
    setWarnings([]);
    setItems([]);
    setText("");
    setProblem(null);
    setPreviewUrl(null);
    goTo({ kind: "start" });
  }

  const unsaved =
    stage.kind === "review"
      ? rows.length
      : stage.kind === "publishing"
        ? items.filter((item) => item.status !== "done").length
        : 0;

  return (
    <div className={PAGE}>
      <Link to="/staff" className="inline-flex min-h-11 items-center text-sm font-semibold">
        <span aria-hidden="true">←&nbsp;</span>Back to needs
      </Link>
      <div className="pt-2 pb-12">
        {stage.kind === "start" ? (
          <IntakeStart
            text={text}
            onTextChange={setText}
            photoAvailable={photoUploadAvailable()}
            onPhoto={onPhoto}
            onText={onText}
            problem={problem}
            onRetry={retry}
            focusHeading={visitedOtherStage}
          />
        ) : null}
        {stage.kind === "analysing" ? (
          <IntakeAnalysing
            key={stage.phase}
            phase={stage.phase}
            uploadPercent={stage.uploadPercent}
            previewUrl={previewUrl}
            onCancel={cancel}
          />
        ) : null}
        {stage.kind === "review" ? (
          <IntakeReview
            rows={rows}
            warnings={warnings}
            previewUrl={previewUrl}
            onChange={changeRow}
            onReplace={replaceRow}
            onSubmit={(publish) => void submit(publish)}
          />
        ) : null}
        {stage.kind === "publishing" ? (
          <IntakePublish
            items={items}
            publish={stage.publish}
            orgSlug={org.slug}
            onRetry={(id) => void retryRow(id)}
            onAddMore={addMore}
          />
        ) : null}
      </div>
      <LeaveDraftsDialog active={unsaved > 0} count={unsaved} />
    </div>
  );
}
