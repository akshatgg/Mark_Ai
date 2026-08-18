"use client";

import type { ElementSummary } from "@/lib/types";

const ROLE_ORDER = ["headline", "subhead", "body", "legal", "logo", "product"];

/**
 * What the service found inside the ad. This is the review surface: if a font
 * came back a guess, or a text block was missed entirely, this is where it
 * shows — before the ad reaches a screen.
 */
export function BlueprintReadout({ elements }: { elements: ElementSummary[] }) {
  const sorted = [...elements].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );

  return (
    // A table will not shrink below its min-content width, so on a narrow screen
    // it widens the whole document and clips every other section. It scrolls
    // inside its own box instead.
    <div className="overflow-x-auto rounded-[10px] border border-line bg-panel">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {["Part", "What it says", "Font", "Match"].map((h) => (
              <th key={h} className="eyebrow px-4 py-2.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((el, i) => {
            const weak = el.font_confidence !== null && el.font_confidence < 0.6;
            return (
              <tr key={`${el.role}-${i}`} className="border-b border-line last:border-0 align-top">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 text-[13px] text-fg">
                    {el.color_hex && (
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                        style={{ background: el.color_hex }}
                        title={el.color_hex}
                      />
                    )}
                    {el.role}
                  </span>
                </td>
                <td className="max-w-[36ch] px-4 py-3 text-[13px] leading-relaxed text-fg-muted">
                  {el.text ?? <span className="text-fg-subtle">image, kept as-is</span>}
                </td>
                <td className="dim px-4 py-3 text-[12px] text-fg-muted">
                  {el.font_family ?? "—"}
                </td>
                <td className="dim px-4 py-3 text-[12px]">
                  {el.font_confidence === null ? (
                    <span className="text-fg-subtle">—</span>
                  ) : (
                    <span style={{ color: weak ? "var(--status-warn)" : "var(--brand-green)" }}>
                      {Math.round(el.font_confidence * 100)}%
                      {weak && " · check"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
