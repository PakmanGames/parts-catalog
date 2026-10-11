"use client";

import { ChevronDown, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ImportSummary } from "@/components/import-summary";
import { LoadError } from "@/components/load-error";
import { Timestamp } from "@/components/timestamp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { ImportStatus, ImportStatusResponse } from "@/contracts/imports";
import { ApiError, getLatestImport, startImport } from "@/lib/api";
import { formatCount, formatDuration, formatMegabytes } from "@/lib/format";
import { cn, toError } from "@/lib/utils";

/** Cloudflare's request body cap (PRD D10), in the decimal megabytes `POST /api/imports` checks. */
const MAX_UPLOAD_BYTES = 100_000_000;

/** How often to check on a running import. */
const POLL_MS = 2_000;

/** What this page is doing with the chosen file before the server takes over. */
type Upload =
  | { step: "idle" }
  | { step: "compressing"; file: File }
  | { step: "uploading"; bytes: number }
  | { step: "failed"; title: string; message: string };

/** Compresses the export in the browser, from about 126 MB to about 36 MB (PRD D10). */
function gzip(file: File): Promise<Blob> {
  return new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

/**
 * Uploads the nightly export and shows the latest import's progress and result (PRD R1.8, 7.5).
 *
 * The import runs on the server after the upload, so the panel polls its status while it runs.
 * It also shows an import someone else started, such as one from `pnpm import:csv`.
 */
export function ImportPanel({
  onImported,
}: {
  /**
   * Called when an import that this page saw running succeeds, so the page can reload the data
   * it changed. The parts table passes its refresh here.
   */
  onImported?: () => void;
}) {
  const inputId = useId();
  const summaryId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<Upload>({ step: "idle" });
  const [status, setStatus] = useState<ImportStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setStatus(await getLatestImport(signal));
      setStatusError(null);
    } catch (error) {
      if (!signal?.aborted) {
        setStatusError(toError(error).message);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const running = status?.status === "running";
  useEffect(() => {
    if (!running) {
      return;
    }
    // Each poll waits for the previous one, so slow responses never pile up.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh(controller.signal);
      if (!controller.signal.aborted) {
        timer = setTimeout(poll, POLL_MS);
      }
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [running, refresh]);

  // Only an import seen finishing reloads the table and opens the summary, not one that had
  // already finished when the page opened.
  const previousStatus = useRef<ImportStatus | undefined>(undefined);
  useEffect(() => {
    if (previousStatus.current === "running" && status?.status === "succeeded") {
      setShowSummary(true);
      onImported?.();
    }
    previousStatus.current = status?.status;
  }, [status, onImported]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      return;
    }

    setUpload({ step: "compressing", file });
    let gzipped: Blob;
    try {
      gzipped = await gzip(file);
    } catch (error) {
      setUpload({
        step: "failed",
        title: "Couldn't read the file",
        message: toError(error).message,
      });
      return;
    }
    if (gzipped.size > MAX_UPLOAD_BYTES) {
      setUpload({
        step: "failed",
        title: "The file is too large to upload",
        message: `Compressed, it is ${formatMegabytes(gzipped.size)}, and uploads are limited to 100 MB. Nothing was uploaded.`,
      });
      return;
    }

    setUpload({ step: "uploading", bytes: gzipped.size });
    try {
      setStatus(await startImport(gzipped));
      setStatusError(null);
      setUpload({ step: "idle" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setUpload({
          step: "failed",
          title: "Your file wasn't uploaded",
          message: "Another import was already running. Import your file again once it finishes.",
        });
        // Show the other import's progress.
        void refresh();
        return;
      }
      setUpload({ step: "failed", title: "Upload failed", message: toError(error).message });
    }
  }

  const busy = upload.step === "compressing" || upload.step === "uploading";

  /** The upload's progress while this page owns it, then the server's status of the latest import. */
  function renderStatus(): ReactNode {
    if (upload.step === "compressing") {
      return (
        <Progress>
          Compressing {upload.file.name} ({formatMegabytes(upload.file.size)})
        </Progress>
      );
    }
    if (upload.step === "uploading") {
      return <Progress>Uploading {formatMegabytes(upload.bytes)}</Progress>;
    }
    if (status === null) {
      if (statusError === null) {
        return <Skeleton className="h-5 w-64 max-w-full" />;
      }
      return (
        <LoadError
          title="Couldn't load the import status"
          message={statusError}
          onRetry={() => void refresh()}
        />
      );
    }
    switch (status.status) {
      case "idle":
        return (
          <p className="text-sm text-muted-foreground">
            No import has run since the server started.
          </p>
        );
      case "running":
        return (
          <Progress>
            Importing since <Timestamp iso={status.startedAt} />. The parts table shows the current
            catalog until the import finishes.
          </Progress>
        );
      case "failed":
        return (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>The last import failed</AlertTitle>
            <AlertDescription>
              {status.error}
              <span className="block">
                Stopped <Timestamp iso={status.finishedAt} />.
              </span>
            </AlertDescription>
          </Alert>
        );
      case "succeeded":
        return (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="flex items-start gap-2 text-sm">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  The last import finished <Timestamp iso={status.finishedAt} />, in{" "}
                  {formatDuration(status.summary.durationMs)}, and read{" "}
                  {formatCount(status.summary.rowsRead)} rows.
                </span>
              </p>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showSummary}
                aria-controls={summaryId}
                onClick={() => setShowSummary((shown) => !shown)}
              >
                {showSummary ? "Hide details" : "Show details"}
                <ChevronDown
                  data-icon="inline-end"
                  className={cn("transition-transform", showSummary && "rotate-180")}
                />
              </Button>
            </div>
            <div id={summaryId} hidden={!showSummary}>
              <ImportSummary summary={status.summary} />
            </div>
          </>
        );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Import the nightly export</h2>
        </CardTitle>
        <CardDescription>
          Choose parts_export.csv. It is compressed in your browser, uploaded, and imported, and you
          can keep browsing while it runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor={inputId}>Export file</Label>
            <Input
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setUpload({ step: "idle" });
              }}
            />
          </div>
          <Button type="submit" disabled={!file || busy || running}>
            Import
          </Button>
        </form>

        {upload.step === "failed" && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>{upload.title}</AlertTitle>
            <AlertDescription>{upload.message}</AlertDescription>
          </Alert>
        )}

        <div aria-live="polite" className="flex flex-col gap-4">
          {renderStatus()}
          {status !== null && statusError !== null && (
            <p className="text-sm text-destructive">
              Couldn't refresh the import status: {statusError}
              {running && " Trying again shortly."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Progress({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm">
      <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
      <span>{children}</span>
    </p>
  );
}
