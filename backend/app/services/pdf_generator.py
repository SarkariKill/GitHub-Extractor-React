"""
PDF generation service — produces the shipper label in the standard
"TECHNICAL INFORMATION / Table 1" tabular format.
"""
import logging

logger = logging.getLogger(__name__)


class PDFGenerationError(Exception):
    pass


def fill_template(final_data: dict, template_path: str, output_path: str) -> None:
    """
    Generate the shipper label PDF in the standard tabular format.

    Layout matches the reference document:
      - Title:    TECHNICAL INFORMATION
      - Subtitle: Table 1: Direct Print Label Required Information
      - Table with columns: Row ID | Description | Direct Print Requirement
      - Footer note and disclaimer

    Args:
        final_data:    Dict of all label fields (including distributed_by)
        template_path: Unused — kept for interface compatibility
        output_path:   Destination path for the generated PDF
    """
    logger.info("Generating shipper label PDF at %s", output_path)

    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            SimpleDocTemplate,
            Paragraph,
            Spacer,
            Table,
            TableStyle,
        )
        from reportlab.lib.enums import TA_CENTER, TA_LEFT

        doc = SimpleDocTemplate(
            output_path,
            pagesize=A4,
            leftMargin=2 * cm,
            rightMargin=2 * cm,
            topMargin=2 * cm,
            bottomMargin=2 * cm,
        )

        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            "TitleStyle",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=18,
            alignment=TA_CENTER,
            spaceAfter=6,
        )

        subtitle_style = ParagraphStyle(
            "SubtitleStyle",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=15,
            alignment=TA_CENTER,
            spaceAfter=14,
        )

        cell_style = ParagraphStyle(
            "CellStyle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
        )

        cell_bold_style = ParagraphStyle(
            "CellBoldStyle",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
        )

        note_style = ParagraphStyle(
            "NoteStyle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            spaceBefore=8,
        )

        def cell(text: str, bold: bool = False) -> Paragraph:
            return Paragraph(
                str(text) if text else "",
                cell_bold_style if bold else cell_style,
            )

        # Safely get values with fallback
        def val(key: str, fallback: str = "") -> str:
            v = final_data.get(key)
            return str(v).strip() if v else fallback

        # Build distributed_by as multi-line cell content
        dist_by_raw = val("distributed_by")
        dist_by_html = dist_by_raw.replace("\n", "<br/>")

        dist_by_cell = Paragraph(dist_by_html, cell_style)

        # Table rows: (row_id, description, value)
        table_rows = [
            # Header
            [
                cell("", bold=True),
                cell("Description", bold=True),
                cell("Direct Print Requirement", bold=True),
            ],
            # Data rows
            [cell("A"), cell("Product Name and Description"),       cell(val("product_name"))],
            [cell("B"), cell("Shipper GTIN Barcode and\nHuman Readable"), cell(val("gtin"))],
            [cell("C"), cell("Quantity per case"),                  cell(val("quantity"))],
            [cell("D"), cell("Inner Pack"),                         cell(val("inner_pack"))],
            [cell("E"), cell("Material Number"),                    cell(val("material_number"))],
            [cell("F"), cell("Label Direct Print\nSpecification Number"), cell(val("label_specification"))],
            [cell("G"), cell("Storage Requirements"),               cell(val("storage_requirements", "(not specified)"))],
            [cell("H"), cell("Batch/Lot number"),                   cell(val("batch_number", "(batch specific, supplied by site)"))],
            [cell("I"), cell("Expiration Date"),                    cell(val("expiration_date", "(batch specific, supplied by site)"))],
            [cell("*"), cell("Distributed By"),                     dist_by_cell],
            [cell("*"), cell("Active Ingredient"),                  cell(val("active_ingredient", "(not specified)"))],
        ]

        # Column widths: row_id | description | value
        page_width = A4[0] - 4 * cm  # usable width
        col_widths = [1 * cm, 6 * cm, page_width - 7 * cm]

        table = Table(table_rows, colWidths=col_widths, repeatRows=1)

        header_bg = colors.HexColor("#D9D9D9")
        border_color = colors.HexColor("#000000")

        table.setStyle(TableStyle([
            # Overall grid
            ("GRID",        (0, 0), (-1, -1), 0.5, border_color),
            ("BOX",         (0, 0), (-1, -1), 1,   border_color),

            # Header row
            ("BACKGROUND",  (0, 0), (-1, 0),  header_bg),
            ("FONTNAME",    (0, 0), (-1, 0),  "Helvetica-Bold"),
            ("FONTSIZE",    (0, 0), (-1, 0),  9),

            # All cells
            ("FONTSIZE",    (0, 1), (-1, -1), 9),
            ("VALIGN",      (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING",  (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",(0,0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING",(0, 0), (-1, -1), 5),

            # Row-id column: center align
            ("ALIGN",       (0, 0), (0, -1),  "CENTER"),
        ]))

        footnote = Paragraph(
            "* Additional printing requirements that must be printed on label",
            note_style,
        )
        disclaimer = Paragraph(
            "<b>Note:</b> The chart above gives the minimum printing requirements. "
            "The figures below show the suggested placement on label. "
            "Site specific layout and label requirements may be added as needed.",
            note_style,
        )

        story = [
            Paragraph("TECHNICAL INFORMATION", title_style),
            Paragraph("Table 1: Direct Print Label Required Information", subtitle_style),
            table,
            footnote,
            Spacer(1, 0.3 * cm),
            disclaimer,
        ]

        doc.build(story)
        logger.info("Shipper label PDF generated successfully at %s", output_path)

    except Exception as e:
        logger.error("PDF generation failed: %s", str(e))
        raise PDFGenerationError(f"Failed to generate PDF: {str(e)}") from e
