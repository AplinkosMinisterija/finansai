/**
 * PDF ataskaitų generatoriai (Iter 14, FVM-6).
 *
 * Naudoja `pdfkit` — generuoja A4 dokumentus su LT diakritinių palaikymu
 * per DejaVu Sans Unicode TTF font'ą (`assets/fonts/DejaVuSans.ttf` +
 * `DejaVuSans-Bold.ttf`). Default Helvetica AFM šriftas neturi LT
 * raidžių (ąčęėįšųūž), todėl reikalingas Unicode TTF.
 *
 * Konvencijos:
 *  - A4 portrait (595 × 842 pt), 40 pt marginai
 *  - Header'is su pavadinimu + tenant + generatedAt
 *  - Footer'is su puslapio numeriu („1 / N")
 *  - Lentelės — paprastas grid'as su antraštės eilute (gray fill)
 *  - Sumos rodomos kaip „1 234,56 €" (LT lokalizacija per `Intl.NumberFormat`)
 *  - Page break automatinis (pdfkit) kai turinys netilpa
 *
 * Failo pavadinimas — pasirinkimas servise.
 */
import path from 'path';
import PDFDocument from 'pdfkit';
import type {
  BudgetExecutionReport,
  PayrollDistributionReport,
  SpecProgramReport,
} from '@biip-finansai/shared';

// Font paths — DejaVu Sans bundle'inta su API repo
// (žr. `apps/api/assets/fonts/`). Build'as kopija nelaiko šitų — naudojam
// runtime resolve relatyviai nuo __dirname (post-build path = dist/utils/reports
// -> ../../assets/fonts, dev path = src/utils/reports -> ../../assets/fonts).
//
// __dirname išspendžiamas runtime tiek dev (tsx) tiek prod (compiled) atveju.
// Abi versijos rezolvina į apps/api/assets/fonts.
const FONT_DIR = path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

/** LT lokalė formatuotojas pinigams. */
const ltMoneyFormatter = new Intl.NumberFormat('lt-LT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Konvertuoja decimal string į „1 234,56 €" formatą (LT). */
function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0,00 €';
  const n = Number(value);
  if (!Number.isFinite(n)) return '0,00 €';
  return `${ltMoneyFormatter.format(n)} €`;
}

/** Procentų formatuotojas — „79,99%". */
function formatPercent(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${ltMoneyFormatter.format(n)}%`;
}

/** Puslapio orientacijos / marginu konstanta. */
const PAGE_MARGIN = 40;

/**
 * Šabloninis PDFDocument'o sukūrimas — registruoja DejaVu Sans font'ą su
 * pavadinimu `'LT'` (Regular) ir `'LT-Bold'` (Bold). Visos generavimo
 * funkcijos turi naudoti šituos pavadinimus.
 *
 * @returns `{ doc, finishPdf }` — `doc` PDFKit instance'as, `finishPdf` —
 *   await'ina pabaigos `Buffer`'ą.
 */
function createDoc(): {
  doc: InstanceType<typeof PDFDocument>;
  finishPdf: () => Promise<Buffer>;
} {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: 'Finansai ataskaita',
      Author: 'Finansai (BIIP)',
      Creator: 'Finansai (BIIP)',
      Producer: 'PDFKit',
    },
  });
  doc.registerFont('LT', FONT_REGULAR);
  doc.registerFont('LT-Bold', FONT_BOLD);
  doc.font('LT');

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finishPdf = (): Promise<Buffer> => {
    return new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));
      doc.end();
    });
  };

  return { doc, finishPdf };
}

/**
 * Header'is — pavadinimas + subtitle (tenant + generatedAt). Centruotas.
 */
function drawHeader(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  subtitle: string,
): void {
  doc.font('LT-Bold').fontSize(16).text(title, { align: 'center' });
  doc.moveDown(0.2);
  doc.font('LT').fontSize(9).fillColor('#666').text(subtitle, { align: 'center' });
  doc.fillColor('#000');
  doc.moveDown(0.8);
}

/**
 * Puslapio numeriai apačioje — kviečiamas po viso turinio sugeneravimo
 * (bufferPages reikia, kad galėtume iteruoti per visus puslapius).
 */
function drawPageNumbers(doc: InstanceType<typeof PDFDocument>): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.font('LT').fontSize(9).fillColor('#666');
    const pageNumStr = `${i + 1} / ${range.count}`;
    const pageHeight = doc.page.height;
    doc.text(pageNumStr, PAGE_MARGIN, pageHeight - PAGE_MARGIN + 8, {
      align: 'center',
      width: doc.page.width - PAGE_MARGIN * 2,
    });
    doc.fillColor('#000');
  }
}

/**
 * Pieš lentelės eilutę. Per `widths` kolonų plotis (santykinai prie
 * `contentWidth`). Stringuoja per cell'es; ilgesni tekstai trinkamos.
 */
interface DrawRowOpts {
  bold?: boolean;
  fillColor?: string;
  fontSize?: number;
  align?: Array<'left' | 'right' | 'center'>;
}

function drawTableRow(
  doc: InstanceType<typeof PDFDocument>,
  columns: string[],
  widths: number[],
  startX: number,
  y: number,
  rowHeight: number,
  opts: DrawRowOpts = {},
): void {
  const fontSize = opts.fontSize ?? 9;
  doc.font(opts.bold ? 'LT-Bold' : 'LT').fontSize(fontSize);

  // Fill (jei nurodyta)
  if (opts.fillColor) {
    const totalWidth = widths.reduce((a, b) => a + b, 0);
    doc.save();
    doc.rect(startX, y, totalWidth, rowHeight).fill(opts.fillColor);
    doc.restore();
    doc.fillColor('#000');
  }

  // Border (kiekvienai cell'ei)
  let x = startX;
  for (let i = 0; i < columns.length; i += 1) {
    const w = widths[i] ?? 0;
    doc.rect(x, y, w, rowHeight).stroke('#CCCCCC');
    const text = columns[i] ?? '';
    const align = opts.align?.[i] ?? 'left';
    doc.text(text, x + 3, y + 4, {
      width: w - 6,
      height: rowHeight - 4,
      align,
      ellipsis: true,
    });
    x += w;
  }
}

/**
 * Apskaičiuoja eilutės aukštį pagal turinį (preliminariai).
 * Šiame pavyzdyje visi eilutės — fixed 18pt aukštas.
 */
const ROW_HEIGHT = 18;
const HEADER_ROW_HEIGHT = 22;

/**
 * Patikrina, ar liko vietos puslapyje rodyti `neededHeight`. Jei ne —
 * pradeda naują puslapį ir grąžina naują y koordinatę (toliau nuo viršaus
 * margo).
 */
function ensureSpace(
  doc: InstanceType<typeof PDFDocument>,
  neededHeight: number,
  currentY: number,
): number {
  const pageBottom = doc.page.height - PAGE_MARGIN - 20; // -20 footer puslapio numeriui
  if (currentY + neededHeight > pageBottom) {
    doc.addPage();
    return PAGE_MARGIN;
  }
  return currentY;
}

// ---------- F12 Biudžeto vykdymas ----------

export async function generateBudgetExecutionPdf(
  data: BudgetExecutionReport,
): Promise<Buffer> {
  const { doc, finishPdf } = createDoc();

  const tenantInfo = data.tenantName
    ? `Organizacija: ${data.tenantName}`
    : 'Organizacija: Visos';
  drawHeader(
    doc,
    `Biudžeto vykdymo ataskaita ${data.year}`,
    `${tenantInfo}   •   Sugeneruota: ${data.generatedAt}`,
  );

  const startX = PAGE_MARGIN;
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  // Kolonos: Kategorija/Allocation | Planuota | Faktinė | Likutis | Naudojimas %
  const widths = [
    contentWidth * 0.42,
    contentWidth * 0.15,
    contentWidth * 0.15,
    contentWidth * 0.15,
    contentWidth * 0.13,
  ];
  const alignArr: Array<'left' | 'right' | 'center'> = [
    'left',
    'right',
    'right',
    'right',
    'right',
  ];

  let y = doc.y;

  for (const source of data.bySource) {
    y = ensureSpace(doc, HEADER_ROW_HEIGHT + ROW_HEIGHT * 2, y);

    // Šaltinio antraštė
    doc.font('LT-Bold').fontSize(11).fillColor('#000');
    doc.text(
      `${source.fundingSourceName} (${source.fundingSourceTypeName})`,
      startX,
      y,
    );
    y = doc.y + 4;

    // Lentelės header
    drawTableRow(
      doc,
      ['Kategorija / eilutė', 'Planuota', 'Faktinė', 'Likutis', 'Naudojimas'],
      widths,
      startX,
      y,
      HEADER_ROW_HEIGHT,
      {
        bold: true,
        fillColor: '#EFEFEF',
        align: alignArr,
      },
    );
    y += HEADER_ROW_HEIGHT;

    for (const cat of source.byCategory) {
      y = ensureSpace(doc, ROW_HEIGHT, y);
      const label = `${cat.categoryName} — ${cat.allocationName}`;
      drawTableRow(
        doc,
        [
          label,
          formatMoney(cat.planuota),
          formatMoney(cat.faktine),
          formatMoney(cat.likutis),
          formatPercent(cat.percentUsed),
        ],
        widths,
        startX,
        y,
        ROW_HEIGHT,
        { align: alignArr },
      );
      y += ROW_HEIGHT;
    }

    // Šaltinio summary
    y = ensureSpace(doc, ROW_HEIGHT, y);
    drawTableRow(
      doc,
      [
        'Iš viso šaltiniui',
        formatMoney(source.planuota),
        formatMoney(source.faktine),
        formatMoney(source.likutis),
        formatPercent(source.percentUsed),
      ],
      widths,
      startX,
      y,
      ROW_HEIGHT,
      { bold: true, fillColor: '#F5F5DC', align: alignArr },
    );
    y += ROW_HEIGHT + 10;
  }

  // Grand total
  y = ensureSpace(doc, ROW_HEIGHT * 2, y);
  doc.moveTo(startX, y).lineTo(startX + contentWidth, y).stroke('#333');
  y += 4;
  drawTableRow(
    doc,
    [
      'IŠ VISO',
      formatMoney(data.totalPlanuota),
      formatMoney(data.totalFaktine),
      formatMoney(data.totalLikutis),
      '',
    ],
    widths,
    startX,
    y,
    ROW_HEIGHT,
    { bold: true, fillColor: '#D3D3D3', align: alignArr, fontSize: 10 },
  );

  drawPageNumbers(doc);
  return finishPdf();
}

// ---------- F13 Spec. programos ----------

export async function generateSpecProgramPdf(
  data: SpecProgramReport,
): Promise<Buffer> {
  const { doc, finishPdf } = createDoc();

  const tenantInfo = data.tenantName
    ? `Organizacija: ${data.tenantName}`
    : 'Organizacija: Visos';
  drawHeader(
    doc,
    `Spec. programų ataskaita ${data.year}`,
    `${tenantInfo}   •   Sugeneruota: ${data.generatedAt}`,
  );

  const startX = PAGE_MARGIN;
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  // Org | Programa | Prašyta | Patvirtinta | Panaudota | Statusas
  const widths = [
    contentWidth * 0.17,
    contentWidth * 0.31,
    contentWidth * 0.13,
    contentWidth * 0.13,
    contentWidth * 0.13,
    contentWidth * 0.13,
  ];
  const alignArr: Array<'left' | 'right' | 'center'> = [
    'left',
    'left',
    'right',
    'right',
    'right',
    'center',
  ];

  let y = doc.y;

  drawTableRow(
    doc,
    [
      'Organizacija',
      'Programa',
      'Prašyta',
      'Patvirtinta',
      'Panaudota',
      'Statusas',
    ],
    widths,
    startX,
    y,
    HEADER_ROW_HEIGHT,
    { bold: true, fillColor: '#EFEFEF', align: alignArr },
  );
  y += HEADER_ROW_HEIGHT;

  for (const item of data.items) {
    y = ensureSpace(doc, ROW_HEIGHT, y);
    drawTableRow(
      doc,
      [
        item.tenantCode,
        item.requestProjectName,
        formatMoney(item.prasyta),
        formatMoney(item.patvirtinta),
        formatMoney(item.panaudota),
        item.projektoStatusas ?? '—',
      ],
      widths,
      startX,
      y,
      ROW_HEIGHT,
      { align: alignArr },
    );
    y += ROW_HEIGHT;
  }

  // Total
  y = ensureSpace(doc, ROW_HEIGHT * 2, y);
  y += 4;
  drawTableRow(
    doc,
    [
      'IŠ VISO',
      '',
      formatMoney(data.totalPrasyta),
      formatMoney(data.totalPatvirtinta),
      formatMoney(data.totalPanaudota),
      '',
    ],
    widths,
    startX,
    y,
    ROW_HEIGHT,
    { bold: true, fillColor: '#D3D3D3', align: alignArr, fontSize: 10 },
  );

  drawPageNumbers(doc);
  return finishPdf();
}

// ---------- F14 DU paskirstymas ----------

export async function generatePayrollDistributionPdf(
  data: PayrollDistributionReport,
): Promise<Buffer> {
  const { doc, finishPdf } = createDoc();

  const tenantInfo = data.tenantName
    ? `Organizacija: ${data.tenantName}`
    : 'Organizacija: Visos';
  drawHeader(
    doc,
    'DU paskirstymo ataskaita',
    `${tenantInfo}   •   Laikotarpis: ${data.from} – ${data.to}   •   Sugeneruota: ${data.generatedAt}`,
  );

  const startX = PAGE_MARGIN;
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;

  // Per profile sekcija
  const profileColWidths = [contentWidth * 0.6, contentWidth * 0.4];
  const profileAlign: Array<'left' | 'right' | 'center'> = ['left', 'right'];

  let y = doc.y;

  for (const prof of data.byProfile) {
    y = ensureSpace(doc, HEADER_ROW_HEIGHT * 2 + ROW_HEIGHT, y);

    // Profile antraštė
    doc.font('LT-Bold').fontSize(11).fillColor('#000');
    doc.text(
      `${prof.vardasPavarde} — ${prof.pareigos} (${prof.tenantCode})`,
      startX,
      y,
    );
    y = doc.y + 4;

    drawTableRow(
      doc,
      ['Finansavimo šaltinis', 'Suma per laikotarpį'],
      profileColWidths,
      startX,
      y,
      HEADER_ROW_HEIGHT,
      { bold: true, fillColor: '#EFEFEF', align: profileAlign },
    );
    y += HEADER_ROW_HEIGHT;

    for (const src of prof.bySource) {
      y = ensureSpace(doc, ROW_HEIGHT, y);
      drawTableRow(
        doc,
        [src.fundingSourceName, formatMoney(src.sumaPerLaikotarpi)],
        profileColWidths,
        startX,
        y,
        ROW_HEIGHT,
        { align: profileAlign },
      );
      y += ROW_HEIGHT;
    }

    // Profile total
    y = ensureSpace(doc, ROW_HEIGHT, y);
    drawTableRow(
      doc,
      ['Iš viso darbuotojui', formatMoney(prof.totalPerLaikotarpi)],
      profileColWidths,
      startX,
      y,
      ROW_HEIGHT,
      { bold: true, fillColor: '#F5F5DC', align: profileAlign },
    );
    y += ROW_HEIGHT + 12;
  }

  // Per šaltinį sekcija (cross-cutting)
  y = ensureSpace(doc, HEADER_ROW_HEIGHT * 2 + 50, y);
  doc.font('LT-Bold').fontSize(13).fillColor('#000');
  doc.text('Iš viso pagal finansavimo šaltinius', startX, y);
  y = doc.y + 8;

  drawTableRow(
    doc,
    ['Finansavimo šaltinis', 'Bendra suma'],
    profileColWidths,
    startX,
    y,
    HEADER_ROW_HEIGHT,
    { bold: true, fillColor: '#EFEFEF', align: profileAlign },
  );
  y += HEADER_ROW_HEIGHT;

  for (const t of data.totalsBySource) {
    y = ensureSpace(doc, ROW_HEIGHT, y);
    drawTableRow(
      doc,
      [`${t.fundingSourceName} (${t.fundingSourceCode})`, formatMoney(t.total)],
      profileColWidths,
      startX,
      y,
      ROW_HEIGHT,
      { align: profileAlign },
    );
    y += ROW_HEIGHT;
  }

  // Grand total
  y = ensureSpace(doc, ROW_HEIGHT * 2, y);
  y += 4;
  drawTableRow(
    doc,
    ['IŠ VISO', formatMoney(data.grandTotal)],
    profileColWidths,
    startX,
    y,
    ROW_HEIGHT,
    { bold: true, fillColor: '#D3D3D3', align: profileAlign, fontSize: 10 },
  );

  drawPageNumbers(doc);
  return finishPdf();
}
