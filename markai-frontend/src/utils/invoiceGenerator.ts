import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Booking } from '@/services/bookingService';

interface TimeSlotDisplay {
  date: string;
  dayName: string;
  start: string;
  end: string;
}

// Parse time slots from booking
const parseTimeSlots = (booking: Booking): TimeSlotDisplay[] => {
  if (!booking.time_slots || booking.time_slots.length === 0) {
    if (booking.start_date && booking.end_date) {
      const startDate = new Date(booking.start_date);
      const endDate = new Date(booking.end_date);
      const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      return [{
        date: startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        dayName: dayNames[startDate.getDay()],
        start: startDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
        end: endDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
      }];
    }
    return [];
  }

  return booking.time_slots.map((slot) => {
    const startDate = new Date(slot.start);
    const endDate = new Date(slot.end);
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

    return {
      date: startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      dayName: dayNames[startDate.getDay()],
      start: startDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
      end: endDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    };
  });
};

export const generateInvoice = (booking: Booking) => {
  const doc = new jsPDF();

  // Professional Light Theme Colors
  const primaryPurple: [number, number, number] = [139, 92, 246]; // Purple
  const lightPurple: [number, number, number] = [237, 233, 254]; // Light purple background
  const greenColor: [number, number, number] = [34, 197, 94]; // Green for GST
  const darkText: [number, number, number] = [17, 24, 39]; // Dark gray text
  const mediumText: [number, number, number] = [75, 85, 99]; // Medium gray
  const lightBg: [number, number, number] = [249, 250, 251]; // Very light gray
  const borderColor: [number, number, number] = [229, 231, 235]; // Border gray

  // Header Background - Light theme
  doc.setFillColor(lightPurple[0], lightPurple[1], lightPurple[2]);
  doc.rect(0, 0, 210, 50, 'F');

  // Mark AI Logo Text (since we can't embed images easily in jsPDF)
  doc.setTextColor(primaryPurple[0], primaryPurple[1], primaryPurple[2]);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('Mark AI', 20, 22);

  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Digital Out-of-Home Advertising Platform', 20, 30);

  // Company Address
  doc.setFontSize(8);
  doc.setTextColor(mediumText[0], mediumText[1], mediumText[2]);
  doc.text('Adneuron Pvt Ltd | Bengaluru, India', 20, 36);
  doc.text('Email: support@markai.co | Phone: +91-XXXXXXXXXX', 20, 41);

  // Invoice Title
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');

  if (booking.gst_enabled) {
    doc.text('TAX INVOICE', 140, 20);
    doc.setFillColor(greenColor[0], greenColor[1], greenColor[2]);
    doc.rect(138, 23, 50, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text('GST REGISTERED', 153, 27);
  } else {
    doc.text('INVOICE', 155, 20);
  }

  // Invoice Details
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Invoice ID: ${booking._id.slice(-12).toUpperCase()}`, 140, 35);

  const invoiceDate = new Date(booking.created_at).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  doc.text(`Date: ${invoiceDate}`, 140, 40);

  let yPosition = 50;

  // Billing Information Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('BILLING INFORMATION', 20, yPosition);
  yPosition += 5;

  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.rect(20, yPosition, 170, 30, 'F');

  yPosition += 7;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  if (booking.gst_enabled && booking.gst_company_name) {
    doc.setFont('helvetica', 'bold');
    doc.text(booking.gst_company_name, 25, yPosition);
    yPosition += 5;
    doc.setFont('helvetica', 'normal');

    if (booking.gstin) {
      doc.text(`GSTIN: ${booking.gstin}`, 25, yPosition);
      yPosition += 5;
    }

    if (booking.gst_address) {
      const addressLines = doc.splitTextToSize(
        `${booking.gst_address}${booking.gst_city ? ', ' + booking.gst_city : ''}${booking.gst_state ? ', ' + booking.gst_state : ''}${booking.gst_pincode ? ' - ' + booking.gst_pincode : ''}`,
        160
      );
      doc.text(addressLines, 25, yPosition);
      yPosition += (addressLines.length * 5);
    }
  } else {
    doc.text('Customer ID: ' + booking.advertiser_id.slice(-12).toUpperCase(), 25, yPosition);
    yPosition += 5;
    doc.text('Booking Date: ' + invoiceDate, 25, yPosition);
    yPosition += 5;
  }

  yPosition += 10;

  // Booking Details Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('BOOKING DETAILS', 20, yPosition);
  yPosition += 7;

  // Screen Information
  autoTable(doc, {
    startY: yPosition,
    head: [['Screen Details', 'Information']],
    body: [
      ['Screen Name', booking.screen_name || 'N/A'],
      ['Booking Type', booking.booking_type === 'multi_screen' ? 'Multi-Screen' : 'Single Screen'],
      ['Start Date', new Date(booking.start_date).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })],
      ['End Date', new Date(booking.end_date).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })],
      ['Payment Status', booking.payment_status.toUpperCase()],
      ['Booking Status', booking.status.toUpperCase()],
    ],
    headStyles: {
      fillColor: primaryPurple,
      textColor: [255, 255, 255],
      fontSize: 10,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 9,
    },
    alternateRowStyles: {
      fillColor: lightBg,
    },
    margin: { left: 20, right: 20 },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  // Time Slots Section
  const timeSlots = parseTimeSlots(booking);
  if (timeSlots.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('BOOKED TIME SLOTS', 20, yPosition);
    yPosition += 7;

    const slotsData = timeSlots.map((slot, index) => [
      `${index + 1}`,
      `${slot.dayName} ${slot.date}`,
      `${slot.start} - ${slot.end}`,
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['#', 'Date', 'Time']],
      body: slotsData,
      headStyles: {
        fillColor: primaryPurple,
        textColor: [255, 255, 255],
        fontSize: 10,
        fontStyle: 'bold',
      },
      bodyStyles: {
        fontSize: 9,
      },
      alternateRowStyles: {
        fillColor: lightBg,
      },
      margin: { left: 20, right: 20 },
    });

    yPosition = (doc as any).lastAutoTable.finalY + 10;
  }

  // Payment Details Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('PAYMENT SUMMARY', 20, yPosition);
  yPosition += 7;

  // Create payment summary box
  const boxStartY = yPosition;
  const boxWidth = 170;
  const boxHeight = booking.gst_enabled ? 65 : 45;

  // Draw box
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.rect(20, boxStartY, boxWidth, boxHeight, 'F');
  doc.setDrawColor(200, 200, 200);
  doc.rect(20, boxStartY, boxWidth, boxHeight, 'S');

  let currentY = boxStartY + 10;

  // Amount breakdown
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);

  if (booking.gst_enabled && booking.base_amount && booking.gst_amount) {
    // Base Amount
    doc.setFont('helvetica', 'normal');
    doc.text('Base Amount', 30, currentY);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${booking.base_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 180, currentY, { align: 'right' });
    currentY += 8;

    // GST
    doc.setFont('helvetica', 'normal');
    doc.text('GST @ 18%', 30, currentY);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${booking.gst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 180, currentY, { align: 'right' });
    currentY += 10;

    // Divider line
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.5);
    doc.line(30, currentY, 180, currentY);
    currentY += 10;
  }

  // Total Amount (Highlighted) - Increased size and better visibility
  const totalBoxY = currentY - 3;
  const totalBoxHeight = 16;

  // Draw colored background box for total
  doc.setFillColor(booking.gst_enabled ? greenColor[0] : primaryPurple[0], booking.gst_enabled ? greenColor[1] : primaryPurple[1], booking.gst_enabled ? greenColor[2] : primaryPurple[2]);
  doc.roundedRect(25, totalBoxY, boxWidth - 10, totalBoxHeight, 3, 3, 'F');

  // Add white text on colored background
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL AMOUNT', 30, currentY + 7);

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs. ${booking.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 180, currentY + 7, { align: 'right' });

  yPosition = boxStartY + boxHeight + 10;

  // Payment Transaction Details
  if (booking.razorpay_payment_id || booking.razorpay_order_id) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
    doc.text('TRANSACTION DETAILS', 20, yPosition);
    yPosition += 7;

    const transactionData: any[][] = [];

    if (booking.razorpay_payment_id) {
      transactionData.push(['Payment ID', booking.razorpay_payment_id]);
    }

    if (booking.razorpay_order_id) {
      transactionData.push(['Order ID', booking.razorpay_order_id]);
    }

    autoTable(doc, {
      startY: yPosition,
      body: transactionData,
      theme: 'striped',
      headStyles: {
        fillColor: primaryPurple,
        textColor: [255, 255, 255] as [number, number, number],
      },
      bodyStyles: {
        fontSize: 9,
        cellPadding: 4,
      },
      columnStyles: {
        0: {
          fontStyle: 'bold',
          cellWidth: 40,
          textColor: darkText,
        },
        1: {
          cellWidth: 130,
          textColor: darkText,
          fontStyle: 'normal',
        },
      },
      margin: { left: 20, right: 20 },
    });

    yPosition = (doc as any).lastAutoTable.finalY + 10;
  }

  // Footer
  const pageHeight = doc.internal.pageSize.height;
  if (yPosition > pageHeight - 40) {
    doc.addPage();
    yPosition = 20;
  }

  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.rect(0, pageHeight - 30, 210, 30, 'F');

  doc.setFontSize(8);
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFont('helvetica', 'normal');
  doc.text('Thank you for your business!', 105, pageHeight - 20, { align: 'center' });
  doc.text('For queries, contact: support@mark-ai.techm', 105, pageHeight - 15, { align: 'center' });

  if (booking.gst_enabled) {
    doc.setFont('helvetica', 'bold');
    doc.text('This is a computer-generated GST invoice', 105, pageHeight - 10, { align: 'center' });
  }

  // Generate filename
  const filename = `Invoice_${booking._id.slice(-12).toUpperCase()}_${new Date().toISOString().split('T')[0]}.pdf`;

  // Save the PDF
  doc.save(filename);
};
