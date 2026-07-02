"""
Dynamic PDF generation service.

Generates a shipper label PDF from any set of field definitions and values.
The layout is a clean two-column table: Label | Value.
The title is derived from the template name.
"""
import logging

logger = logging.getLogger(__name__)


class PDFGenerationError(Exception):
    pass


def _format_title(template_name: str) -> str:
    return template_name.replace("_", " ").replace("-", " ").upper()


def generate_dynamic_pdf(
    template_name: str,
    fields: list[dict],
    values: dict,
    output_path: str,
) -> None:
    """
    Generate a PDF from any dynamic field list and values dict.

    Args:
        template_name : Used as the document title (underscores → spaces, upper-cased).
        fields        : List of field defs from get_template_fields() —
                        each has {field_name, label, field_type, ...}.
        values        : Dict of {field_name: value_string} for every field.
        output_path   : Destination path for the generated PDF.
    """
    logger.info("Generating dynamic PDF for template '%s' at %s", template_name, output_path)

    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        )

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
            "DynTitle",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            alignment=TA_CENTER,
            spaceAfter=12,
        )

        header_cell_style = ParagraphStyle(
            "DynHeader",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
        )

        cell_style = ParagraphStyle(
            "DynCell",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
        )

        def h(text: str) -> Paragraph:
            return Paragraph(str(text), header_cell_style)

        def c(text: str) -> Paragraph:
            raw = str(text) if text else ""
            # Support newlines stored as \n in values
            html = raw.replace("\n", "<br/>")
            return Paragraph(html, cell_style)

        def field_value(field_name: str) -> str:
            v = values.get(field_name)
            return str(v).strip() if v else ""

        header_bg = colors.HexColor("#D9D9D9")
        border_color = colors.HexColor("#000000")

        table_rows: list = [[h("Print Elements"), h("Print Requirements")]]

        for f in fields:
            fname = f.get("field_name") or f.get("field_key", "")
            label = f.get("label", fname)
            val = field_value(fname)
            table_rows.append([c(label), c(val)])

        page_width = A4[0] - 4 * cm
        col_widths = [page_width * 0.38, page_width * 0.62]

        table = Table(table_rows, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ("GRID",          (0, 0), (-1, -1), 0.5, border_color),
            ("BOX",           (0, 0), (-1, -1), 1,   border_color),
            ("BACKGROUND",    (0, 0), (-1, 0),  header_bg),
            ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 9),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ]))

        story = [
            Paragraph(_format_title(template_name), title_style),
            table,
            Spacer(1, 0.4 * cm),
        ]

        doc.build(story)
        logger.info("Dynamic PDF generated successfully at %s", output_path)

    except Exception as e:
        logger.error("Dynamic PDF generation failed: %s", str(e))
        raise PDFGenerationError(f"Failed to generate PDF: {str(e)}") from e
