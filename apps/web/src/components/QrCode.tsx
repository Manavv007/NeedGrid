import { create } from "qrcode";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** White modules around the code. The light card it sits on adds more quiet zone. */
const QUIET_MODULES = 2;

/**
 * The dark modules of a QR code for `value` as one SVG path, in module units (one `h` run per
 * stretch of dark modules in a row). Error correction M survives a scuffed screen or print.
 */
export function qrPath(value: string): { size: number; d: string } {
  const { modules } = create(value, { errorCorrectionLevel: "M" });
  const { size } = modules;
  let d = "";
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!modules.get(row, col)) {
        col += 1;
        continue;
      }
      let run = 1;
      while (col + run < size && modules.get(row, col + run)) run += 1;
      d += `M${col} ${row}h${run}v1h-${run}z`;
      col += run;
    }
  }
  return { size, d };
}

type QrCodeProps = {
  /** What the code opens, e.g. the tile wall's full URL. */
  value: string;
  /** Accessible name, e.g. "QR code: scan to see what Harbor Food Bank needs". */
  label: string;
  className?: string;
};

/** A crisp QR code, dark on white, drawn as SVG (scales to any size, prints sharply). */
export function QrCode({ value, label, className }: QrCodeProps) {
  const { size, d } = useMemo(() => qrPath(value), [value]);
  const box = size + QUIET_MODULES * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET_MODULES} ${-QUIET_MODULES} ${box} ${box}`}
      shapeRendering="crispEdges"
      className={cn("bg-surface", className)}
    >
      <path d={d} className="fill-foreground" />
    </svg>
  );
}
