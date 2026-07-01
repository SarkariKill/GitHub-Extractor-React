"""
PDF generation service — produces the shipper label in the
"REQUIRED PRINT INFORMATION" tabular format (Template 2).

Columns: Print Elements | Print Requirements | Creation Guidance
"""
import logging

logger = logging.getLogger(__name__)


class PDFGenerationError(Exception):
    pass


def fill_template2(final_data: dict, output_path: str) -> None:
    """
    Generate the shipper label PDF in the 'REQUIRED PRINT INFORMATION' format.

    Layout matches the reference document:
      - Title:   REQUIRED PRINT INFORMATION
      - Table with columns: Print Elements | Print Requirements | Creation Guidance
    """
    logger.info("Generating Template 2 shipper label PDF at %s", output_path)

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
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY

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
            "TitleStyle2",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            alignment=TA_CENTER,
            spaceAfter=12,
        )

        header_cell_style = ParagraphStyle(
            "HeaderCell2",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            alignment=TA_LEFT,
        )

        cell_style = ParagraphStyle(
            "CellStyle2",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
        )

        guidance_style = ParagraphStyle(
            "GuidanceStyle2",
            parent=styles["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=8,
            leading=11,
        )

        def h(text: str) -> Paragraph:
            return Paragraph(str(text), header_cell_style)

        def c(text: str) -> Paragraph:
            return Paragraph(str(text) if text else "", cell_style)

        def g(text: str) -> Paragraph:
            return Paragraph(str(text) if text else "", guidance_style)

        def val(key: str, fallback: str = "") -> str:
            v = final_data.get(key)
            return str(v).strip() if v else fallback

        # Combine batch + expiration into single cell
        batch = val("batch_number")
        exp = val("expiration_date")
        if batch and exp:
            batch_exp_val = f"{batch} / {exp}"
        elif batch:
            batch_exp_val = batch
        elif exp:
            batch_exp_val = exp
        else:
            batch_exp_val = ""

        dist_by_raw = val("distributed_by")
        dist_by_html = dist_by_raw.replace("\n", "<br/>")
        dist_by_cell = Paragraph(dist_by_html, cell_style)

        country = val("country_of_origin_active", "N/A")
        special = val("special_requirements", "N/A")

        table_rows = [
            # Header
            [h("Print Elements"), h("Print Requirements"), h("Creation Guidance")],
            # Data rows
            [
                c("Product Name, Description, and Size"),
                c(val("product_name")),
                g("Must be on shipper as shown."),
            ],
            [
                c("Quantity per Case"),
                c(val("quantity")),
                g("Format adjustment is acceptable.\nIE: 1 Dozen in lieu of 12, 12 EA."),
            ],
            [
                c("Inner Pack"),
                c(val("inner_pack")),
                g("# of inners in a case x # of EA's in an inner pack\n\n"
                  "Format adjustment is acceptable.\nIE: (#x#), (##'s), # inners of #'s"),
            ],
            [
                c("Product Code"),
                c(val("material_number")),
                g(""),
            ],
            [
                c("Shipper GTIN Barcode and Human Readable"),
                c(val("gtin")),
                g("GTIN Format: ITF-14 or GS1-128 barcode with human readable number printed below barcode"),
            ],
            [
                c("Batch/Lot Code & Expiration Date"),
                c(batch_exp_val),
                g(""),
            ],
            [
                c("Storage Requirements"),
                c(val("storage_requirements")),
                g("Must be on shipper as shown."),
            ],
            [
                c("Distributed By"),
                dist_by_cell,
                g("Must be on shipper as shown."),
            ],
            [
                c("Country of Origin of Active"),
                c("This field is not applicable"),
                g("N/A"),
            ],
            [
                c("Special Requirements"),
                c(country if country != "N/A" else "This field is not applicable"),
                g("N/A"),
            ],
        ]

        page_width = A4[0] - 4 * cm
        col_widths = [page_width * 0.28, page_width * 0.40, page_width * 0.32]

        table = Table(table_rows, colWidths=col_widths, repeatRows=1)

        header_bg = colors.HexColor("#D9D9D9")
        border_color = colors.HexColor("#000000")

        table.setStyle(TableStyle([
            ("GRID",          (0, 0), (-1, -1), 0.5, border_color),
            ("BOX",           (0, 0), (-1, -1), 1,   border_color),
            ("BACKGROUND",    (0, 0), (-1, 0),  header_bg),
            ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, 0),  9),
            ("FONTSIZE",      (0, 1), (-1, -1), 9),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 5),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
        ]))

        story = [
            Paragraph("REQUIRED PRINT INFORMATION", title_style),
            table,
        ]

        doc.build(story)
        logger.info("Template 2 PDF generated successfully at %s", output_path)

    except Exception as e:
        logger.error("Template 2 PDF generation failed: %s", str(e))
        raise PDFGenerationError(f"Failed to generate Template 2 PDF: {str(e)}") from e
