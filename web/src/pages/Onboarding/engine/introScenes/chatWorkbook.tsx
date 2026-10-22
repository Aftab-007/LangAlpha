import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Bar } from './charts';
import { useSceneTime } from './clock';

/* The Analyst's workbook in the ptcSandbox scene: comps.xlsx as the file
   panel previews it, its rows and formulas, and the cells filling in as
   the workflow's build step writes them. The chart in the Analyst's reply reads the
   same rows. */
/* eslint-disable react-refresh/only-export-components -- scene part:
   the panel plus the rows its chart reads */

/** The spreadsheet viewer's paper and ink (`ExcelViewer.css`): a white sheet
    in either theme, every shade of its chrome mixed from the two. */
const SHEET = {
  paper: 'var(--color-sheet-paper)',
  ink: 'var(--color-sheet-ink)',
  rule: 'color-mix(in srgb, var(--color-sheet-ink) 12%, var(--color-sheet-paper))',
  chrome: 'color-mix(in srgb, var(--color-sheet-ink) 4%, var(--color-sheet-paper))',
  chromeStrong: 'color-mix(in srgb, var(--color-sheet-ink) 7%, var(--color-sheet-paper))',
  inkMuted: 'color-mix(in srgb, var(--color-sheet-ink) 55%, var(--color-sheet-paper))',
};

/** The workbook's own styling, as the xlsx skill writes it: section bands,
    column-header fill, and the font colour code (blue typed input, black
    formula, green link to another sheet). The viewer draws a file's fills
    and colours as authored, so these hold in either theme. */
const BOOK = {
  band: '#1F4E79',
  head: '#D9E1F2',
  input: '#0000FF',
  formula: '#000000',
  link: '#008000',
};

/** A cell the workbook holds: a typed value, or a formula with the value it
    caches. */
type SheetValue = string | { f: string; v: string };

/** A row of the sheet: merged across the table (the title, its note, a
    section band), a row of cells, or empty. */
type SheetRow =
  | { kind: 'title' | 'note' | 'band'; text: string }
  | { kind: 'head' | 'data' | 'stat'; cells: (SheetValue | null)[] }
  | { kind: 'blank' };

/** Columns the table spans; a merged row spans them all. */
const TABLE_COLS = 6;

/** One peer: ticker, price and market cap typed in, then its multiples and
    growth linked from the Data sheet (row `n` there). */
function peer(
  ticker: string,
  price: string,
  cap: string,
  evs: string,
  pe: string,
  growth: string,
  n: number
): SheetRow {
  const r = n + 4; // its row on this sheet
  return {
    kind: 'data',
    cells: [
      ticker,
      price,
      cap,
      { f: `=Data!D${n}/Data!E${n}`, v: evs },
      { f: `=B${r}/Data!F${n}`, v: pe },
      { f: `=Data!G${n}`, v: growth },
    ],
  };
}

/** The comps sheet the build step writes, laid out as the comps skill lays
    one out: title and basis, the valuation band, nine peers, then the
    statistics on the comparable columns only (never price or size), and
    NVDA against the median. The statistics' cached values are the real
    results of their formulas over these rows (QUARTILE is inclusive). */
const COMPS: SheetRow[] = [
  { kind: 'title', text: 'AI semis: comparable company analysis' },
  { kind: 'note', text: 'Prices as of 2026-10-20 · USD bn · NTM estimates' },
  { kind: 'blank' },
  { kind: 'band', text: 'VALUATION' },
  { kind: 'head', cells: ['Ticker', 'Price', 'Mkt cap', 'EV/S', 'P/E', 'Growth'] },
  peer('NVDA', '182.42', '4,452', '24.1x', '38.2x', '62%', 2),
  peer('AVGO', '349.80', '1,646', '22.6x', '36.9x', '24%', 3),
  peer('TSM', '292.15', '1,515', '10.4x', '22.8x', '31%', 4),
  peer('AMD', '236.10', '383', '9.8x', '31.5x', '27%', 5),
  peer('ARM', '151.60', '160', '30.2x', '72.4x', '21%', 6),
  peer('QCOM', '168.25', '184', '4.3x', '15.6x', '9%', 7),
  peer('MU', '201.30', '225', '4.2x', '11.9x', '38%', 8),
  peer('MRVL', '88.40', '76', '9.1x', '29.7x', '34%', 9),
  peer('INTC', '37.85', '166', '2.9x', '34.1x', '-2%', 10),
  { kind: 'blank' },
  {
    kind: 'stat',
    cells: [
      '75th pctl',
      null,
      null,
      { f: '=QUARTILE(D6:D14,3)', v: '22.6x' },
      { f: '=QUARTILE(E6:E14,3)', v: '36.9x' },
      { f: '=QUARTILE(F6:F14,3)', v: '34%' },
    ],
  },
  {
    kind: 'stat',
    cells: [
      'Median',
      null,
      null,
      { f: '=MEDIAN(D6:D14)', v: '9.8x' },
      { f: '=MEDIAN(E6:E14)', v: '31.5x' },
      { f: '=MEDIAN(F6:F14)', v: '27%' },
    ],
  },
  {
    kind: 'stat',
    cells: [
      '25th pctl',
      null,
      null,
      { f: '=QUARTILE(D6:D14,1)', v: '4.3x' },
      { f: '=QUARTILE(E6:E14,1)', v: '22.8x' },
      { f: '=QUARTILE(F6:F14,1)', v: '21%' },
    ],
  },
  { kind: 'blank' },
  {
    kind: 'stat',
    cells: [
      'NVDA vs median',
      null,
      null,
      { f: '=D6/D17-1', v: '146%' },
      { f: '=E6/E17-1', v: '21%' },
      { f: '=F6-F17', v: '35%' },
    ],
  },
];

/** The chart in the reply, from the same rows: EV/Sales, high to low. */
export const EV_SALES: Bar[] = COMPS.flatMap((row) => {
  if (row.kind !== 'data') return [];
  const [ticker, , , evs] = row.cells as [string, string, string, { v: string }];
  return [{ label: ticker, value: parseFloat(evs.v), shown: evs.v, mark: ticker === 'NVDA' }];
}).sort((a, b) => b.value - a.value);

const SHEET_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
/** Column widths (px): labels wide in A, as the skill sets it; the empty
    columns run off the panel's edge, as a sheet does. */
const SHEET_COL_W = [49, 23, 24, 19, 19, 22, 24, 24, 24, 24];
/** Rows drawn: the table, then empty rows to the panel's foot. */
const SHEET_ROWS = 28;

/** When each written cell lands, the first at `start`: rows a beat apart,
    each row left to right; the computed rows take a little longer, as their
    formulas do. */
function sheetWrites(start: number): { r: number; c: number; at: number }[] {
  const writes: { r: number; c: number; at: number }[] = [];
  let at = start;
  COMPS.forEach((row, r) => {
    if (row.kind === 'blank') return;
    if (!('cells' in row)) {
      writes.push({ r, c: 0, at });
      at += 120;
      return;
    }
    row.cells.forEach((cell, c) => {
      if (cell != null) writes.push({ r, c, at: at + c * 30 });
    });
    at += row.kind === 'stat' ? 200 : 150;
  });
  return writes;
}

/** A row or column heading in the sheet's margin; `active` = it holds the
    focused cell. */
function SheetHeading({ active = false, children }: { active?: boolean; children?: ReactNode }) {
  return (
    <span
      className="flex items-center justify-center font-mono text-[0.25rem] leading-none"
      style={{
        background: active ? SHEET.chromeStrong : SHEET.chrome,
        color: active ? SHEET.ink : SHEET.inkMuted,
      }}
    >
      {children}
    </span>
  );
}

/** The focused cell's outline, in ink as the viewer draws it. */
const focusRing = (on: boolean): CSSProperties =>
  on ? { boxShadow: `inset 0 0 0 1px ${SHEET.ink}` } : {};

/** A row merged across the table: the title, its note, or a section band. */
function MergedCell({
  kind,
  text,
  focus,
}: {
  kind: 'title' | 'note' | 'band';
  text: string;
  focus: boolean;
}) {
  return (
    <span
      className={cn(
        'flex items-center overflow-hidden whitespace-nowrap px-[2px] leading-none',
        kind === 'title' ? 'text-[0.40625rem] font-bold' : 'text-[0.3125rem]',
        kind === 'band' && 'font-bold tracking-[0.04em]',
        kind === 'note' && 'italic'
      )}
      style={{
        gridColumn: `span ${TABLE_COLS}`,
        fontFamily: 'var(--font-content)',
        background: kind === 'band' ? BOOK.band : SHEET.paper,
        color: kind === 'band' ? '#FFFFFF' : kind === 'note' ? SHEET.inkMuted : SHEET.ink,
        ...focusRing(focus),
      }}
    >
      {text}
    </span>
  );
}

/** One cell as the grid prints it: labels in the content font from the left,
    numbers in mono from the right in the workbook's colour code, a formula's
    value over its dotted rule, the header row on its fill. */
function SheetCell({
  value,
  kind,
  c,
  focus,
}: {
  value: SheetValue | null;
  kind?: 'head' | 'data' | 'stat';
  c: number;
  focus: boolean;
}) {
  const label = c === 0 && typeof value === 'string';
  const formula = value != null && typeof value === 'object';
  const ink = !value
    ? SHEET.ink
    : formula
      ? value.f.includes('!')
        ? BOOK.link
        : BOOK.formula
      : kind === 'data' && !label
        ? BOOK.input
        : SHEET.ink;
  return (
    <span
      className={cn(
        'relative flex items-center overflow-hidden whitespace-nowrap px-[2px] text-[0.3125rem] leading-none',
        label ? 'justify-start' : 'justify-end'
      )}
      style={{
        background: kind === 'head' && c < TABLE_COLS ? BOOK.head : SHEET.paper,
        color: ink,
        fontFamily: label || kind === 'head' ? 'var(--font-content)' : 'var(--font-mono)',
        fontWeight: kind === 'head' || (label && value === 'NVDA vs median') ? 700 : 400,
        ...focusRing(focus),
      }}
    >
      {value != null && (
        <span
          style={
            formula
              ? {
                  textDecoration: `underline dotted ${SHEET.inkMuted}`,
                  textUnderlineOffset: 1,
                }
              : undefined
          }
        >
          {typeof value === 'string' ? value : value.v}
        </span>
      )}
    </span>
  );
}

/** A sheet's tab under the grid. */
function SheetTab({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      className="rounded-[3px] border px-1 py-0.5 text-[0.375rem] leading-none"
      style={
        active
          ? {
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border-default)',
              color: 'var(--iv-text)',
            }
          : { borderColor: 'var(--color-border-muted)', color: 'var(--iv-text-3)' }
      }
    >
      {children}
    </span>
  );
}

/** The value a cell holds, if the script has written it by now. */
function cellAt(r: number, c: number): SheetValue | null {
  const row = COMPS[r];
  if (!row || row.kind === 'blank') return null;
  if ('cells' in row) return row.cells[c] ?? null;
  return c === 0 ? row.text : null;
}

/** The file panel open on the workbook (`FilePanel`, `ExcelViewer`): the
    file's tab, the formula bar, the sheet, and the sheet tabs. The cells
    fill in as the build step writes them, the focus following the last
    write, and the formula bar reading the focused cell: its formula and
    cached value, or the value typed there. The first cell is written at
    `at`. */
export function SheetPanel({ at }: { at: number }) {
  const t = useSceneTime();
  const writes = useMemo(() => sheetWrites(at), [at]);
  const written = writes.filter((w) => w.at <= t);
  const shown = new Set(written.map((w) => `${w.r}:${w.c}`));
  const focus = written.at(-1);
  const focused = focus ? cellAt(focus.r, focus.c) : null;
  const ref = focus ? `${SHEET_COLS[focus.c]}${focus.r + 1}` : 'A1';
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* tab strip */}
      <div
        className="flex h-[18px] shrink-0 items-center border-b px-1"
        style={{ borderColor: 'var(--color-border-muted)' }}
      >
        <span
          className="flex h-3 min-w-0 items-center gap-0.5 rounded-[3px] border px-1"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border-muted)',
            color: 'var(--iv-text)',
          }}
        >
          <FileSpreadsheet className="h-2 w-2 shrink-0" />
          <span className="truncate text-[0.4375rem] leading-none">comps.xlsx</span>
        </span>
        <X className="ml-auto h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      </div>
      {/* formula bar: the focused cell's reference, formula and cached value */}
      <div
        className="flex h-3 shrink-0 items-stretch border-b font-mono text-[0.3125rem] leading-none"
        style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border-muted)' }}
      >
        <span
          className="flex w-5 items-center border-r px-1 font-medium"
          style={{ borderColor: 'var(--color-border-muted)', color: 'var(--iv-text)' }}
        >
          {ref}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 px-1">
          <span className="shrink-0 italic" style={{ color: 'var(--iv-text-3)' }}>
            fx
          </span>
          {focused != null && (
            <span className="truncate" style={{ color: 'var(--iv-text-2)' }}>
              {typeof focused === 'string' ? focused : focused.f}
            </span>
          )}
          {focused != null && typeof focused === 'object' && (
            <span className="ml-auto shrink-0 font-medium" style={{ color: 'var(--iv-text)' }}>
              {focused.v}
            </span>
          )}
        </span>
      </div>
      {/* the sheet: lettered columns, numbered rows, hairline rules */}
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: SHEET.rule }}>
        <div
          className="absolute left-0 top-0 grid gap-px"
          style={{
            gridTemplateColumns: `9px ${SHEET_COL_W.map((w) => `${w}px`).join(' ')}`,
            gridTemplateRows: `7px repeat(${SHEET_ROWS}, 9px)`,
          }}
        >
          <span style={{ background: SHEET.chromeStrong }} />
          {SHEET_COLS.map((col, c) => (
            <SheetHeading key={col} active={focus?.c === c}>
              {col}
            </SheetHeading>
          ))}
          {Array.from({ length: SHEET_ROWS }, (_, r) => {
            const row = COMPS[r];
            const merged = row && 'text' in row;
            const isFocus = (c: number) => focus?.r === r && focus.c === c;
            return [
              <SheetHeading key={`n${r}`} active={focus?.r === r}>
                {r + 1}
              </SheetHeading>,
              merged && shown.has(`${r}:0`) ? (
                <MergedCell key={`${r}m`} kind={row.kind} text={row.text} focus={isFocus(0)} />
              ) : merged ? (
                <span
                  key={`${r}m`}
                  style={{ gridColumn: `span ${TABLE_COLS}`, background: SHEET.paper }}
                />
              ) : null,
              ...SHEET_COLS.slice(merged ? TABLE_COLS : 0).map((col, i) => {
                const c = merged ? i + TABLE_COLS : i;
                return (
                  <SheetCell
                    key={`${r}${col}`}
                    value={shown.has(`${r}:${c}`) ? cellAt(r, c) : null}
                    kind={row && 'cells' in row ? row.kind : undefined}
                    c={c}
                    focus={isFocus(c)}
                  />
                );
              }),
            ];
          })}
        </div>
      </div>
      {/* sheet tabs */}
      <div
        className="flex shrink-0 items-center gap-0.5 border-t px-1 py-1"
        style={{ borderColor: 'var(--color-border-muted)' }}
      >
        <SheetTab active>Comps</SheetTab>
        <SheetTab>Data</SheetTab>
        <SheetTab>Checks</SheetTab>
      </div>
    </div>
  );
}
