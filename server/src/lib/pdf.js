import PDFDocument from 'pdfkit';

const NAVY = '#17365C';
const STRIPE = '#F1F4F7';
const LINE = '#C9D1DA';
const MONO_KEYS = new Set(['sha256', 'md5']);

/**
 * Streams a landscape A4 PDF table report to `out`. Columns are [key, label, weight]; weights set the
 * share of the page width each column gets. Long values wrap, and the header row repeats on every page.
 */
export function writeReportPdf(out, { title, subtitle, generatedBy, generatedAt, filters, columns, rows }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true, info: { Title: title, Author: generatedBy } });
  doc.pipe(out);

  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const totalWeight = columns.reduce((sum, [, , w = 1]) => sum + w, 0);
  const widths = columns.map(([, , w = 1]) => (usable * w) / totalWeight);
  const bottom = () => doc.page.height - doc.page.margins.bottom - 18;
  const pad = 3;

  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(title, left, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#444')
    .text(subtitle)
    .text(`Generated ${generatedAt} by ${generatedBy}`)
    .text(filters ? `Filters: ${filters}` : 'Filters: none')
    .text(`${rows.length} row(s)`);
  doc.moveDown(0.6);

  const cellFont = (key) => (MONO_KEYS.has(key) ? ['Courier', 6.5] : ['Helvetica', 7.5]);

  function header() {
    doc.font('Helvetica-Bold').fontSize(7.5);
    const h = Math.max(...columns.map(([, label], i) => doc.heightOfString(label, { width: widths[i] - pad * 2 }))) + pad * 2;
    let x = left;
    const y = doc.y;
    doc.rect(left, y, usable, h).fill(NAVY);
    columns.forEach(([, label], i) => {
      doc.fillColor('#FFFFFF').text(label, x + pad, y + pad, { width: widths[i] - pad * 2 });
      x += widths[i];
    });
    doc.y = y + h;
  }

  header();
  rows.forEach((row, index) => {
    const values = columns.map(([key]) => (row[key] === null || row[key] === undefined || row[key] === '' ? '-' : String(row[key])));
    const heights = values.map((value, i) => {
      const [font, size] = cellFont(columns[i][0]);
      return doc.font(font).fontSize(size).heightOfString(value, { width: widths[i] - pad * 2 });
    });
    const h = Math.max(...heights) + pad * 2;
    if (doc.y + h > bottom()) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    if (index % 2) doc.rect(left, y, usable, h).fill(STRIPE);
    let x = left;
    values.forEach((value, i) => {
      const [font, size] = cellFont(columns[i][0]);
      doc.font(font).fontSize(size).fillColor('#111').text(value, x + pad, y + pad, { width: widths[i] - pad * 2 });
      x += widths[i];
    });
    doc.moveTo(left, y + h).lineTo(left + usable, y + h).lineWidth(0.4).strokeColor(LINE).stroke();
    doc.y = y + h;
  });
  if (!rows.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555').text('No rows match these filters.', left, doc.y + 8);

  // Footer on every page, written with the bottom margin lifted so it does not trigger a new page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor('#666')
      .text(`Digital Forensics Case and Evidence Management Portal  |  ${title}`, left, doc.page.height - 24, { width: usable / 2, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, left + usable / 2, doc.page.height - 24, { width: usable / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }
  doc.end();
}
