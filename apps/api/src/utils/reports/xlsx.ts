/**
 * Excel (.xlsx) ataskaitų generatoriai (Iter 14, FVM-6).
 *
 * Naudoja `exceljs` library — generuoja vieną workbook'ą per ataskaitą,
 * grąžina `Buffer`'į, kurį Moleculer.web grąžina kaip binary response.
 *
 * Konvencijos:
 *  - LT lokalizacija (column headers, formatting)
 *  - Decimal sumos rodomos su 2 skaitmenimis po kablelio + " €" suffix'as
 *  - Header eilutė bold + lightGrey fill
 *  - Summary eilutės (jei yra) — bold
 *  - Visi worksheet'ai turi „freeze panes" ant header eilutės (UX patogumui)
 *  - autoFilter — vartotojui galima filter'inti per Excel native UI
 *
 * Failo pavadinimas (priklauso servisui):
 *  - `biudzeto-vykdymas-YYYY-<generatedAt>.xlsx`
 *  - `spec-programos-YYYY-<generatedAt>.xlsx`
 *  - `du-paskirstymas-FROM-TO-<generatedAt>.xlsx`
 */
import ExcelJS from 'exceljs';
import type {
  BudgetExecutionReport,
  PayrollDistributionReport,
  SpecProgramReport,
} from '@biip-finansai/shared';

/** Pinigų formatas Excel'ui — naudojamas kolonoms su decimal sumomis. */
const MONEY_FORMAT = '#,##0.00 "€"';

/** Procentų formatas Excel'ui — naudojamas `percentUsed` kolonoms. */
const PERCENT_FORMAT = '0.00"%"';

/**
 * Konvertuoja decimal string'ą į `number`'į Excel cell value'iui.
 * Jei reikšmė nevaliduota / NaN — grąžina 0 (Excel saugu).
 */
function toCellNumber(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Stilizuoja header eilutę: bold + lightGrey fill + center alignment.
 */
function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true, size: 11 };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFEF' },
    };
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  row.height = 28;
}

/**
 * Generuoja F12 Biudžeto vykdymo ataskaitos Excel failą.
 *
 * Struktura:
 *  - 1 sheet'as „Biudžeto vykdymas YYYY"
 *  - Header'is su tenant + generatedAt info
 *  - Tuščia eilutė
 *  - Lentelė: Finansavimo šaltinis | Šaltinio tipas | Kategorija | Allocation |
 *             Planuota | Faktinė | Likutis | Naudojimas %
 *  - Per kiekvieną source — group rows + summary
 *  - Apačia: bendras TOTAL
 */
export async function generateBudgetExecutionXlsx(
  data: BudgetExecutionReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finansai (BIIP)';
  wb.created = new Date(data.generatedAt);
  const ws = wb.addWorksheet(`Biudžeto vykdymas ${data.year}`);

  // Header info
  ws.mergeCells('A1:H1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Biudžeto vykdymo ataskaita ${data.year}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  ws.mergeCells('A2:H2');
  const subtitleCell = ws.getCell('A2');
  const tenantInfo = data.tenantName
    ? `Organizacija: ${data.tenantName}`
    : 'Organizacija: Visos';
  subtitleCell.value = `${tenantInfo}  •  Sugeneruota: ${data.generatedAt}`;
  subtitleCell.font = { italic: true, size: 10 };
  subtitleCell.alignment = { horizontal: 'center' };

  // Header row (row 4)
  const headerRowIdx = 4;
  ws.getRow(headerRowIdx).values = [
    'Finansavimo šaltinis',
    'Šaltinio tipas',
    'Kategorija',
    'Biudžeto eilutė',
    'Planuota',
    'Faktinė',
    'Likutis',
    'Naudojimas %',
  ];
  styleHeaderRow(ws.getRow(headerRowIdx));

  // Column widths
  ws.columns = [
    { key: 'fundingSourceName', width: 30 },
    { key: 'fundingSourceTypeName', width: 18 },
    { key: 'categoryName', width: 22 },
    { key: 'allocationName', width: 32 },
    { key: 'planuota', width: 16 },
    { key: 'faktine', width: 16 },
    { key: 'likutis', width: 16 },
    { key: 'percentUsed', width: 14 },
  ];

  let currentRow = headerRowIdx + 1;
  for (const source of data.bySource) {
    // Source row su summary (bold)
    const sourceRow = ws.getRow(currentRow);
    sourceRow.values = [
      source.fundingSourceName,
      source.fundingSourceTypeName,
      '— Iš viso šaltiniui —',
      '',
      toCellNumber(source.planuota),
      toCellNumber(source.faktine),
      toCellNumber(source.likutis),
      source.percentUsed,
    ];
    sourceRow.font = { bold: true };
    sourceRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F5DC' },
      };
    });
    sourceRow.getCell(5).numFmt = MONEY_FORMAT;
    sourceRow.getCell(6).numFmt = MONEY_FORMAT;
    sourceRow.getCell(7).numFmt = MONEY_FORMAT;
    sourceRow.getCell(8).numFmt = PERCENT_FORMAT;
    currentRow += 1;

    // Per kategorijos eilutes (vienam šaltiniui)
    for (const cat of source.byCategory) {
      const row = ws.getRow(currentRow);
      row.values = [
        '', // šaltinis jau aukščiau
        '',
        cat.categoryName,
        cat.allocationName,
        toCellNumber(cat.planuota),
        toCellNumber(cat.faktine),
        toCellNumber(cat.likutis),
        cat.percentUsed,
      ];
      row.getCell(5).numFmt = MONEY_FORMAT;
      row.getCell(6).numFmt = MONEY_FORMAT;
      row.getCell(7).numFmt = MONEY_FORMAT;
      row.getCell(8).numFmt = PERCENT_FORMAT;
      // Warning flag'ai — spalva
      if (cat.isOver) {
        row.getCell(8).font = { color: { argb: 'FFCC0000' }, bold: true };
      } else if (cat.isWarning) {
        row.getCell(8).font = { color: { argb: 'FFFFA500' }, bold: true };
      }
      currentRow += 1;
    }
  }

  // Bendras TOTAL eilutė
  currentRow += 1;
  const totalRow = ws.getRow(currentRow);
  totalRow.values = [
    'IŠ VISO',
    '',
    '',
    '',
    toCellNumber(data.totalPlanuota),
    toCellNumber(data.totalFaktine),
    toCellNumber(data.totalLikutis),
    '',
  ];
  totalRow.font = { bold: true, size: 12 };
  totalRow.getCell(5).numFmt = MONEY_FORMAT;
  totalRow.getCell(6).numFmt = MONEY_FORMAT;
  totalRow.getCell(7).numFmt = MONEY_FORMAT;
  totalRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' },
    };
    cell.border = { top: { style: 'medium' } };
  });

  // Freeze panes ant header
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];

  // Auto-filter
  ws.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx, column: 8 },
  };

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generuoja F13 Spec. programų ataskaitos Excel failą.
 */
export async function generateSpecProgramXlsx(
  data: SpecProgramReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finansai (BIIP)';
  wb.created = new Date(data.generatedAt);
  const ws = wb.addWorksheet(`Spec. programos ${data.year}`);

  ws.mergeCells('A1:I1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Spec. programų ataskaita ${data.year}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  ws.mergeCells('A2:I2');
  const subtitleCell = ws.getCell('A2');
  const tenantInfo = data.tenantName
    ? `Organizacija: ${data.tenantName}`
    : 'Organizacija: Visos';
  subtitleCell.value = `${tenantInfo}  •  Sugeneruota: ${data.generatedAt}`;
  subtitleCell.font = { italic: true, size: 10 };
  subtitleCell.alignment = { horizontal: 'center' };

  const headerRowIdx = 4;
  ws.getRow(headerRowIdx).values = [
    'Organizacija',
    'Programos pavadinimas',
    'Finansavimo tipas',
    'Prašyta',
    'Patvirtinta',
    'Panaudota',
    'Likutis',
    'Naudojimas %',
    'Projekto statusas',
  ];
  styleHeaderRow(ws.getRow(headerRowIdx));

  ws.columns = [
    { key: 'tenantName', width: 26 },
    { key: 'requestProjectName', width: 40 },
    { key: 'specProgramFundingType', width: 22 },
    { key: 'prasyta', width: 14 },
    { key: 'patvirtinta', width: 14 },
    { key: 'panaudota', width: 14 },
    { key: 'likutis', width: 14 },
    { key: 'percentUsed', width: 14 },
    { key: 'projektoStatusas', width: 16 },
  ];

  let currentRow = headerRowIdx + 1;
  for (const item of data.items) {
    const row = ws.getRow(currentRow);
    const fundingTypeLabel =
      item.specProgramFundingType === 'atskiras'
        ? 'Atskiras (rinkliavos)'
        : item.specProgramFundingType === 'biudzeto_dalis'
        ? 'Biudžeto dalis'
        : '—';
    row.values = [
      item.tenantName,
      item.requestProjectName,
      fundingTypeLabel,
      toCellNumber(item.prasyta),
      toCellNumber(item.patvirtinta),
      toCellNumber(item.panaudota),
      toCellNumber(item.likutis),
      item.percentUsed,
      item.projektoStatusas ?? '— nesukurtas —',
    ];
    row.getCell(4).numFmt = MONEY_FORMAT;
    row.getCell(5).numFmt = MONEY_FORMAT;
    row.getCell(6).numFmt = MONEY_FORMAT;
    row.getCell(7).numFmt = MONEY_FORMAT;
    row.getCell(8).numFmt = PERCENT_FORMAT;
    currentRow += 1;
  }

  // Total
  currentRow += 1;
  const totalRow = ws.getRow(currentRow);
  totalRow.values = [
    'IŠ VISO',
    '',
    '',
    toCellNumber(data.totalPrasyta),
    toCellNumber(data.totalPatvirtinta),
    toCellNumber(data.totalPanaudota),
    '',
    '',
    '',
  ];
  totalRow.font = { bold: true, size: 12 };
  totalRow.getCell(4).numFmt = MONEY_FORMAT;
  totalRow.getCell(5).numFmt = MONEY_FORMAT;
  totalRow.getCell(6).numFmt = MONEY_FORMAT;
  totalRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' },
    };
    cell.border = { top: { style: 'medium' } };
  });

  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  ws.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx, column: 9 },
  };

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generuoja F14 DU paskirstymo ataskaitos Excel failą.
 *
 * 2 sheet'ai:
 *  - „Pagal darbuotojus" — kiekvienas darbuotojas + jo šaltiniai
 *  - „Pagal šaltinius" — visi šaltiniai sumuoti (cross-cutting view)
 *
 * SAUGUMO REIKALAVIMAS: šitas generator'ius kviečiamas TIK po
 * `requireDuAccess` guard'o servise. Pati funkcija nedaro permission
 * tikrinimo — atsako už duomenų generavimą iš jau filter'iuotos `data`.
 */
export async function generatePayrollDistributionXlsx(
  data: PayrollDistributionReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finansai (BIIP)';
  wb.created = new Date(data.generatedAt);

  // Sheet 1 — Pagal darbuotojus
  const ws1 = wb.addWorksheet('Pagal darbuotojus');
  ws1.mergeCells('A1:F1');
  const t1 = ws1.getCell('A1');
  t1.value = 'DU paskirstymo ataskaita';
  t1.font = { bold: true, size: 14 };
  t1.alignment = { horizontal: 'center' };

  ws1.mergeCells('A2:F2');
  const s1 = ws1.getCell('A2');
  const tenantInfo = data.tenantName
    ? `Organizacija: ${data.tenantName}`
    : 'Organizacija: Visos';
  s1.value = `${tenantInfo}  •  Laikotarpis: ${data.from} – ${data.to}  •  Sugeneruota: ${data.generatedAt}`;
  s1.font = { italic: true, size: 10 };
  s1.alignment = { horizontal: 'center' };

  const h1Idx = 4;
  ws1.getRow(h1Idx).values = [
    'Vardas Pavardė',
    'Pareigos',
    'Organizacija',
    'Finansavimo šaltinis',
    'Suma per laikotarpį',
    'Iš viso darbuotojui',
  ];
  styleHeaderRow(ws1.getRow(h1Idx));

  ws1.columns = [
    { key: 'vardasPavarde', width: 28 },
    { key: 'pareigos', width: 28 },
    { key: 'tenantName', width: 26 },
    { key: 'fundingSourceName', width: 28 },
    { key: 'sumaPerLaikotarpi', width: 18 },
    { key: 'totalPerLaikotarpi', width: 18 },
  ];

  let cur = h1Idx + 1;
  for (const prof of data.byProfile) {
    const totalRow = ws1.getRow(cur);
    totalRow.values = [
      prof.vardasPavarde,
      prof.pareigos,
      prof.tenantName,
      '— Iš viso —',
      '',
      toCellNumber(prof.totalPerLaikotarpi),
    ];
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F5DC' },
      };
    });
    totalRow.getCell(6).numFmt = MONEY_FORMAT;
    cur += 1;

    for (const src of prof.bySource) {
      const row = ws1.getRow(cur);
      row.values = [
        '',
        '',
        '',
        src.fundingSourceName,
        toCellNumber(src.sumaPerLaikotarpi),
        '',
      ];
      row.getCell(5).numFmt = MONEY_FORMAT;
      cur += 1;
    }
  }

  // Grand total
  cur += 1;
  const grandTotalRow = ws1.getRow(cur);
  grandTotalRow.values = ['IŠ VISO', '', '', '', '', toCellNumber(data.grandTotal)];
  grandTotalRow.font = { bold: true, size: 12 };
  grandTotalRow.getCell(6).numFmt = MONEY_FORMAT;
  grandTotalRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' },
    };
    cell.border = { top: { style: 'medium' } };
  });

  ws1.views = [{ state: 'frozen', ySplit: h1Idx }];

  // Sheet 2 — Pagal šaltinius
  const ws2 = wb.addWorksheet('Pagal šaltinius');
  ws2.mergeCells('A1:C1');
  const t2 = ws2.getCell('A1');
  t2.value = 'DU pasiskirstymas pagal finansavimo šaltinius';
  t2.font = { bold: true, size: 14 };
  t2.alignment = { horizontal: 'center' };

  const h2Idx = 3;
  ws2.getRow(h2Idx).values = ['Finansavimo šaltinis', 'Kodas', 'Bendra suma'];
  styleHeaderRow(ws2.getRow(h2Idx));

  ws2.columns = [
    { key: 'fundingSourceName', width: 36 },
    { key: 'fundingSourceCode', width: 16 },
    { key: 'total', width: 18 },
  ];

  let cur2 = h2Idx + 1;
  for (const t of data.totalsBySource) {
    const row = ws2.getRow(cur2);
    row.values = [t.fundingSourceName, t.fundingSourceCode, toCellNumber(t.total)];
    row.getCell(3).numFmt = MONEY_FORMAT;
    cur2 += 1;
  }

  cur2 += 1;
  const ws2TotalRow = ws2.getRow(cur2);
  ws2TotalRow.values = ['IŠ VISO', '', toCellNumber(data.grandTotal)];
  ws2TotalRow.font = { bold: true, size: 12 };
  ws2TotalRow.getCell(3).numFmt = MONEY_FORMAT;
  ws2TotalRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' },
    };
    cell.border = { top: { style: 'medium' } };
  });

  ws2.views = [{ state: 'frozen', ySplit: h2Idx }];

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
