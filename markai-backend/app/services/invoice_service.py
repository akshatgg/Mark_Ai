"""
Invoice Service
Generates professional tax invoices for bookings
"""
import os
import io
from datetime import datetime
from typing import Dict, Any, Optional
from jinja2 import Template
from app.config.config import settings

# Try importing WeasyPrint for PDF generation
try:
    from weasyprint import HTML
    PDF_ENGINE = "weasyprint"
    print("[Invoice Service] Using WeasyPrint for PDF generation")
except ImportError:
    PDF_ENGINE = None
    print("[Invoice Service] WARNING: WeasyPrint not available. Install with: pip install weasyprint")


class InvoiceService:
    """Service for generating tax invoices"""

    @staticmethod
    def generate_invoice_pdf(booking_data: Dict[str, Any]) -> Optional[bytes]:
        """
        Generate invoice PDF from booking data

        Args:
            booking_data: Dictionary containing all booking information

        Returns:
            PDF bytes or None if generation fails
        """
        if not PDF_ENGINE:
            print("[Invoice] ERROR: WeasyPrint not available")
            return None

        try:
            print(f"[Invoice] Generating invoice for booking: {booking_data.get('booking_id')}")

            # Read HTML template
            template_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                'templates',
                'invoice.html'
            )

            with open(template_path, 'r', encoding='utf-8') as f:
                template_content = f.read()

            # Prepare template data
            template_data = InvoiceService._prepare_template_data(booking_data)

            # Render HTML with Jinja2
            template = Template(template_content)
            html_content = template.render(**template_data)
            print("[Invoice] Template rendered successfully")

            # Generate PDF
            pdf_bytes = HTML(string=html_content, base_url=os.path.dirname(template_path)).write_pdf()
            print(f"[Invoice] PDF generated successfully ({len(pdf_bytes)} bytes)")

            return pdf_bytes

        except Exception as e:
            print(f"[Invoice] ERROR generating PDF: {str(e)}")
            import traceback
            traceback.print_exc()
            return None

    @staticmethod
    def _prepare_template_data(booking_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Prepare data for invoice template

        Args:
            booking_data: Raw booking data from database

        Returns:
            Dictionary formatted for template rendering
        """
        # Parse dates
        start_date_str = booking_data.get('start_date', '')
        end_date_str = booking_data.get('end_date', '')

        if isinstance(start_date_str, datetime):
            start_date = start_date_str
        elif start_date_str:
            try:
                start_date = datetime.fromisoformat(start_date_str.replace('Z', '+00:00'))
            except:
                start_date = datetime.now()
        else:
            start_date = datetime.now()

        if isinstance(end_date_str, datetime):
            end_date = end_date_str
        elif end_date_str:
            try:
                end_date = datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
            except:
                end_date = datetime.now()
        else:
            end_date = datetime.now()

        # Format dates
        start_date_formatted = start_date.strftime('%d %b %Y, %-I:%M %p') if os.name != 'nt' else start_date.strftime('%d %b %Y, %I:%M %p')
        end_date_formatted = end_date.strftime('%d %b %Y, %-I:%M %p') if os.name != 'nt' else end_date.strftime('%d %b %Y, %I:%M %p')
        invoice_date_formatted = datetime.now().strftime('%d %b %Y')

        # Prepare time slots (limit to 10 to fit in A4, max 2 pages)
        time_slots_formatted = []
        time_slots = booking_data.get('time_slots', [])
        total_slots = len(time_slots)

        for slot in time_slots[:10]:  # Limit to first 10 slots
            slot_start = slot.get('start', '')
            slot_end = slot.get('end', '')

            if slot_start and slot_end:
                try:
                    if isinstance(slot_start, str):
                        slot_start_dt = datetime.fromisoformat(slot_start.replace('Z', '+00:00'))
                    else:
                        slot_start_dt = slot_start

                    if isinstance(slot_end, str):
                        slot_end_dt = datetime.fromisoformat(slot_end.replace('Z', '+00:00'))
                    else:
                        slot_end_dt = slot_end

                    date_str = slot_start_dt.strftime('%a %d %b')
                    time_str = f"{slot_start_dt.strftime('%H:%M')} - {slot_end_dt.strftime('%H:%M')}"

                    time_slots_formatted.append({
                        'date': date_str,
                        'time': time_str
                    })
                except Exception as e:
                    print(f"[Invoice] Error formatting time slot: {e}")

        # Determine booking type
        booking_type = booking_data.get('booking_type', 'single')
        booking_type_display = "Multi-Screen" if booking_type == 'multi_screen' else "Single Screen"

        # Prepare billing information
        billing_company_name = booking_data.get('business_name') or booking_data.get('gst_company_name') or 'Customer'
        billing_gstin = booking_data.get('gstin', '')
        billing_address = booking_data.get('gst_address', '')
        billing_city = booking_data.get('gst_city', '')
        billing_state = booking_data.get('gst_state', '')
        billing_pincode = booking_data.get('gst_pincode', '')

        # Generate invoice ID (use booking ID or create one)
        booking_id = str(booking_data.get('_id', ''))
        invoice_id = booking_id[-12:].upper() if len(booking_id) >= 12 else booking_id.upper()

        return {
            'invoice_id': invoice_id,
            'invoice_date': invoice_date_formatted,
            'billing_company_name': billing_company_name,
            'billing_gstin': billing_gstin,
            'billing_address': billing_address,
            'billing_city': billing_city,
            'billing_state': billing_state,
            'billing_pincode': billing_pincode,
            'screen_name': booking_data.get('screen_name', 'N/A'),
            'booking_type': booking_type_display,
            'start_date': start_date_formatted,
            'end_date': end_date_formatted,
            'payment_status': booking_data.get('payment_status', 'pending'),
            'booking_status': booking_data.get('status', 'pending'),
            'campaign_name': booking_data.get('campaign_name', ''),
            'time_slots': time_slots_formatted,
            'total_slots': total_slots,
            'has_more_slots': total_slots > 10,
            'remaining_slots': max(0, total_slots - 10),
            'base_amount': booking_data.get('base_amount', 0),
            'gst_amount': booking_data.get('gst_amount', 0),
            'total_amount': booking_data.get('total_amount', 0),
            'payment_id': booking_data.get('razorpay_payment_id', ''),
            'order_id': booking_data.get('razorpay_order_id', ''),
            'support_email': settings.SMTP_FROM_EMAIL,
            'current_year': datetime.now().year,
            'generated_at': datetime.now().strftime('%d %b %Y, %I:%M %p')
        }

    @staticmethod
    async def generate_and_upload_invoice(booking_data: Dict[str, Any]) -> Optional[str]:
        """
        Generate invoice PDF and upload to GCS

        Args:
            booking_data: Booking information

        Returns:
            GCS URL of uploaded invoice or None if failed
        """
        from app.services.gcs_service import GCSService

        try:
            # Generate PDF
            pdf_bytes = InvoiceService.generate_invoice_pdf(booking_data)
            if not pdf_bytes:
                print("[Invoice] Failed to generate PDF")
                return None

            # Create file-like object for GCS upload
            booking_id = str(booking_data.get('_id', ''))
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"invoice_{booking_id}_{timestamp}.pdf"

            # Create file wrapper for GCS
            class PDFFile:
                def __init__(self, pdf_data, fname):
                    self.data = pdf_data
                    self.filename = fname
                    self.content_type = 'application/pdf'

                def read(self, size=-1):
                    return self.data if size == -1 else self.data[:size]

                def seek(self, pos, whence=0):
                    pass

                def tell(self):
                    return len(self.data)

            pdf_file = PDFFile(pdf_bytes, filename)

            # Upload to GCS
            folder = f"invoices/{datetime.now().year}/{datetime.now().month:02d}"
            result = GCSService.upload_media(
                file=io.BytesIO(pdf_bytes),
                media_type="raw",
                folder=folder,
                public_id=filename
            )

            invoice_url = result.get('url')
            print(f"[Invoice] Uploaded to GCS: {invoice_url}")

            return invoice_url

        except Exception as e:
            print(f"[Invoice] ERROR uploading invoice: {str(e)}")
            import traceback
            traceback.print_exc()
            return None


# Create singleton instance
invoice_service = InvoiceService()
