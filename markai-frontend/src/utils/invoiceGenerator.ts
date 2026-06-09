import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Booking } from '@/services/bookingService';

/* ────────────────────────────────────────────────────────────────────────────
   Brand palette — mirrors theme.css (PDF needs numeric RGB triplets).
   If theme.css changes, update these and nothing else.
   ──────────────────────────────────────────────────────────────────────────── */
const COLOR = {
  brandBlue: [47, 86, 224] as [number, number, number],   // --brand-blue
  brandBlueDark: [37, 65, 179] as [number, number, number], // --brand-blue-dark
  brandCyan: [31, 196, 207] as [number, number, number],  // --brand-cyan
  brandGreen: [79, 184, 79] as [number, number, number],  // --brand-green
  text: [17, 24, 39] as [number, number, number],         // --color-text
  textMuted: [75, 85, 99] as [number, number, number],    // --color-text-muted
  textSubtle: [107, 114, 128] as [number, number, number],// --color-text-subtle
  textFaint: [156, 163, 175] as [number, number, number], // --color-text-faint
  surface: [255, 255, 255] as [number, number, number],   // --color-surface
  surfaceElev: [243, 244, 248] as [number, number, number],// --color-surface-elev
  surfaceTint: [240, 244, 255] as [number, number, number],// soft brand-blue tint
  border: [229, 231, 235] as [number, number, number],    // --color-border (≈ same as soft border)
  white: [255, 255, 255] as [number, number, number],
};

const LOGO_PATH = '/mark_ai_logo2-removebg-preview.png';

/** Load image asset → base64 data URL so jsPDF can embed it. */
const loadImageAsDataURL = async (path: string): Promise<string | null> => {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Logo load failed, falling back to wordmark', e);
    return null;
  }
};

interface TimeSlotDisplay {
  date: string;
  dayName: string;
  start: string;
  end: string;
}

const parseTimeSlots = (booking: Booking): TimeSlotDisplay[] => {
  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  if (!booking.time_slots || booking.time_slots.length === 0) {
    if (booking.start_date && booking.end_date) {
      const startDate = new Date(booking.start_date);
      const endDate = new Date(booking.end_date);
      return [{
        date: startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        dayName: dayNames[startDate.getDay()],
        start: startDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        end: endDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      }];
    }
    return [];
  }

  return booking.time_slots.map((slot) => {
    const startDate = new Date(slot.start);
    const endDate = new Date(slot.end);
    return {
      date: startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      dayName: dayNames[startDate.getDay()],
      start: startDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      end: endDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    };
  });
};

const inr = (amount: number) =>
  `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const generateInvoice = async (booking: Booking) => {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.width;
  const pageH = doc.internal.pageSize.height;
  const margin = 20;

  /* ─────────── Header band ─────────── */
  // 3-px brand-gradient accent across the very top (rendered as two solid bands)
  doc.setFillColor(...COLOR.brandBlue);
  doc.rect(0, 0, pageW / 2, 3, 'F');
  doc.setFillColor(...COLOR.brandCyan);
  doc.rect(pageW / 2, 0, pageW / 2, 3, 'F');

  // Header content area
  let y = 12;
  const logoData = await loadImageAsDataURL(LOGO_PATH);
  if (logoData) {
    try {
      doc.addImage(logoData, 'PNG', margin, y, 14, 14, undefined, 'FAST');
    } catch {
      /* swallow — fallback to wordmark only */
    }
  }

  // Wordmark
  doc.setTextColor(...COLOR.brandBlue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('MARK AI', margin + 18, y + 10);

  // Tagline + company line
  doc.setTextColor(...COLOR.textSubtle);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Digital Out-of-Home Advertising Platform', margin + 18, y + 16);
  doc.text('Adneuron Pvt Ltd · Bengaluru, India · hello@mark-ai.tech', margin, y + 24);

  // Right-side invoice meta — small caps eyebrow + big invoice id + date
  const rightX = pageW - margin;
  const isGst = booking.gst_enabled;
  doc.setTextColor(...COLOR.textSubtle);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(isGst ? 'TAX INVOICE' : 'INVOICE', rightX, y + 2, { align: 'right' });

  doc.setTextColor(...COLOR.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`#${booking._id.slice(-10).toUpperCase()}`, rightX, y + 10, { align: 'right' });

  doc.setTextColor(...COLOR.textMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const invoiceDate = new Date(booking.created_at).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  doc.text(`Issued ${invoiceDate}`, rightX, y + 16, { align: 'right' });

  if (isGst) {
    // GST badge
    doc.setFillColor(...COLOR.brandGreen);
    doc.roundedRect(rightX - 30, y + 19, 30, 6, 2, 2, 'F');
    doc.setTextColor(...COLOR.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('GST REGISTERED', rightX - 15, y + 23.2, { align: 'center' });
  }

  // Header divider line
  y = 40;
  doc.setDrawColor(...COLOR.border);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);

  /* ─────────── Billing card ─────────── */
  y += 8;
  doc.setTextColor(...COLOR.textSubtle);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('BILL TO', margin, y);

  y += 5;
  doc.setFillColor(...COLOR.surfaceTint);
  const billBoxH = isGst && booking.gst_address ? 32 : 22;
  doc.roundedRect(margin, y, pageW - margin * 2, billBoxH, 2, 2, 'F');

  let billY = y + 7;
  doc.setTextColor(...COLOR.text);
  doc.setFontSize(10);

  if (isGst && booking.gst_company_name) {
    doc.setFont('helvetica', 'bold');
    doc.text(booking.gst_company_name, margin + 6, billY);
    billY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (booking.gstin) {
      doc.setTextColor(...COLOR.textMuted);
      doc.text(`GSTIN  ${booking.gstin}`, margin + 6, billY);
      billY += 5;
    }
    if (booking.gst_address) {
      const addr = `${booking.gst_address}${booking.gst_city ? ', ' + booking.gst_city : ''}${booking.gst_state ? ', ' + booking.gst_state : ''}${booking.gst_pincode ? ' - ' + booking.gst_pincode : ''}`;
      const lines = doc.splitTextToSize(addr, pageW - margin * 2 - 12);
      doc.text(lines, margin + 6, billY);
      billY += lines.length * 4.5;
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.text(`Customer ID  ${booking.advertiser_id.slice(-10).toUpperCase()}`, margin + 6, billY);
    billY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR.textMuted);
    doc.setFontSize(9);
    doc.text(`Booking placed on ${invoiceDate}`, margin + 6, billY);
  }

  y = y + billBoxH + 10;

  /* ─────────── Booking details ─────────── */
  doc.setTextColor(...COLOR.textSubtle);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('BOOKING DETAILS', margin, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Field', 'Value']],
    body: [
      ['Screen', booking.screen_name || '—'],
      ['Type', booking.booking_type === 'multi_screen' ? 'Multi-Screen' : 'Single Screen'],
      ['Start', new Date(booking.start_date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })],
      ['End', new Date(booking.end_date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })],
      ['Payment', booking.payment_status.toUpperCase()],
      ['Status', booking.status.toUpperCase()],
    ],
    theme: 'plain',
    headStyles: {
      fillColor: COLOR.brandBlue,
      textColor: COLOR.white,
      fontSize: 9,
      fontStyle: 'bold',
      cellPadding: { top: 3, right: 6, bottom: 3, left: 6 },
    },
    bodyStyles: {
      fontSize: 9,
      textColor: COLOR.text,
      cellPadding: { top: 3, right: 6, bottom: 3, left: 6 },
    },
    alternateRowStyles: { fillColor: COLOR.surfaceElev },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: COLOR.textMuted, cellWidth: 40 },
    },
    margin: { left: margin, right: margin },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  /* ─────────── Time slots ─────────── */
  const slots = parseTimeSlots(booking);
  if (slots.length > 0) {
    doc.setTextColor(...COLOR.textSubtle);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('BOOKED TIME SLOTS', margin, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      head: [['#', 'Date', 'Time']],
      body: slots.map((s, i) => [`${i + 1}`, `${s.dayName} ${s.date}`, `${s.start} – ${s.end}`]),
      theme: 'plain',
      headStyles: {
        fillColor: COLOR.brandBlue,
        textColor: COLOR.white,
        fontSize: 9,
        fontStyle: 'bold',
        cellPadding: { top: 3, right: 6, bottom: 3, left: 6 },
      },
      bodyStyles: { fontSize: 9, textColor: COLOR.text, cellPadding: { top: 3, right: 6, bottom: 3, left: 6 } },
      alternateRowStyles: { fillColor: COLOR.surfaceElev },
      columnStyles: { 0: { cellWidth: 10, fontStyle: 'bold', textColor: COLOR.textMuted } },
      margin: { left: margin, right: margin },
    });

    y = (doc as any).lastAutoTable.finalY + 8;
  }

  /* ─────────── Payment summary ─────────── */
  doc.setTextColor(...COLOR.textSubtle);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('PAYMENT SUMMARY', margin, y);
  y += 3;

  const summaryBoxX = margin;
  const summaryBoxW = pageW - margin * 2;
  const hasGstBreakdown = isGst && booking.base_amount && booking.gst_amount;
  const summaryBoxH = hasGstBreakdown ? 46 : 22;

  doc.setFillColor(...COLOR.surface);
  doc.setDrawColor(...COLOR.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(summaryBoxX, y, summaryBoxW, summaryBoxH, 2, 2, 'FD');

  let sy = y + 8;

  if (hasGstBreakdown) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...COLOR.textMuted);
    doc.text('Base amount', summaryBoxX + 8, sy);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLOR.text);
    doc.text(inr(booking.base_amount!), summaryBoxX + summaryBoxW - 8, sy, { align: 'right' });
    sy += 7;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR.textMuted);
    doc.text('GST @ 18%', summaryBoxX + 8, sy);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLOR.text);
    doc.text(inr(booking.gst_amount!), summaryBoxX + summaryBoxW - 8, sy, { align: 'right' });
    sy += 5;

    doc.setDrawColor(...COLOR.border);
    doc.line(summaryBoxX + 8, sy, summaryBoxX + summaryBoxW - 8, sy);
    sy += 7;
  }

  // Brand-blue total bar
  const totalY = sy - 4;
  const totalH = 14;
  doc.setFillColor(...COLOR.brandBlue);
  doc.roundedRect(summaryBoxX + 4, totalY, summaryBoxW - 8, totalH, 2, 2, 'F');

  doc.setTextColor(...COLOR.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('TOTAL', summaryBoxX + 10, totalY + 9);

  doc.setFontSize(14);
  doc.text(inr(booking.total_amount), summaryBoxX + summaryBoxW - 10, totalY + 9.2, { align: 'right' });

  y = y + summaryBoxH + 10;

  /* ─────────── Transaction details ─────────── */
  if (booking.razorpay_payment_id || booking.razorpay_order_id) {
    if (y > pageH - 60) {
      doc.addPage();
      y = 30;
    }

    doc.setTextColor(...COLOR.textSubtle);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('TRANSACTION DETAILS', margin, y);
    y += 3;

    const txn: any[][] = [];
    if (booking.razorpay_payment_id) txn.push(['Payment ID', booking.razorpay_payment_id]);
    if (booking.razorpay_order_id) txn.push(['Order ID', booking.razorpay_order_id]);

    autoTable(doc, {
      startY: y,
      body: txn,
      theme: 'plain',
      bodyStyles: { fontSize: 9, textColor: COLOR.text, cellPadding: { top: 3, right: 6, bottom: 3, left: 6 } },
      alternateRowStyles: { fillColor: COLOR.surfaceElev },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40, textColor: COLOR.textMuted },
        1: { textColor: COLOR.text },
      },
      margin: { left: margin, right: margin },
    });

    y = (doc as any).lastAutoTable.finalY + 8;
  }

  /* ─────────── Footer ─────────── */
  const footerY = pageH - 18;
  // Thin brand-blue stripe above footer
  doc.setFillColor(...COLOR.brandBlue);
  doc.rect(0, footerY - 4, pageW, 0.6, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.textSubtle);
  doc.text('Thank you for choosing Mark AI', pageW / 2, footerY, { align: 'center' });
  doc.text('Questions? hello@mark-ai.tech · mark-ai.tech', pageW / 2, footerY + 5, { align: 'center' });
  if (isGst) {
    doc.setFont('helvetica', 'bold');
    doc.text('This is a computer-generated GST invoice', pageW / 2, footerY + 10, { align: 'center' });
  }

  const filename = `MarkAI_Invoice_${booking._id.slice(-10).toUpperCase()}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
};
