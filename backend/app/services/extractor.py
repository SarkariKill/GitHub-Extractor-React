"""
PDF extraction service — real implementations using pdfplumber.
"""
import io
import logging
import re

import pdfplumber

logger = logging.getLogger(__name__)


class ExtractionError(Exception):
    pass


def extract_formula_data(formula_pdf: bytes | io.IOBase) -> dict:
    """
    Extract formula information from the Master Formula PDF.

    Looks for country-of-origin text to determine the active ingredient label.

    Args:
        formula_pdf: Raw PDF bytes or file-like object

    Returns:
        dict with key: active_ingredient
    """
    logger.info("Extracting formula data from PDF")

    try:
        if isinstance(formula_pdf, (bytes, bytearray)):
            source = io.BytesIO(formula_pdf)
        else:
            source = formula_pdf

        text = ""
        with pdfplumber.open(source) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"

        text_lower = text.lower()

        if "india" in text_lower:
            active_ingredient = "Active ingredient made in India"
        elif "usa" in text_lower:
            active_ingredient = "Active ingredient made in USA"
        else:
            active_ingredient = None

        return {"active_ingredient": active_ingredient}

    except Exception as e:
        logger.error("Formula extraction failed: %s", str(e))
        raise ExtractionError(f"Failed to extract formula data: {str(e)}") from e


def extract_storage_data(storage_pdf: bytes | io.IOBase) -> dict:
    """
    Extract storage and shipping information from the Storage and Shipping PDF.

    Reads tables for storage requirements and uses regex for batch/expiry fields.

    Args:
        storage_pdf: Raw PDF bytes or file-like object

    Returns:
        dict with keys: storage_requirements, batch_number, expiration_date
    """
    logger.info("Extracting storage data from PDF")

    result = {
        "storage_requirements": None,
        "batch_number": None,
        "expiration_date": None,
    }

    try:
        if isinstance(storage_pdf, (bytes, bytearray)):
            source = io.BytesIO(storage_pdf)
        else:
            source = storage_pdf

        full_text = ""

        with pdfplumber.open(source) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    full_text += page_text + "\n"

                try:
                    tables = page.extract_tables()
                except Exception:
                    tables = []

                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    # Clean headers
                    headers = []
                    for h in table[0]:
                        if h is None:
                            headers.append("")
                            continue
                        clean_header = (
                            str(h)
                            .replace("\n", " ")
                            .replace("\r", " ")
                            .strip()
                            .lower()
                        )
                        headers.append(clean_header)

                    row = table[1]

                    logger.debug("HEADERS: %s", headers)
                    logger.debug("ROW: %s", row)

                    for idx, header in enumerate(headers):
                        normalized_header = (
                            header
                            .replace(" ", "")
                            .replace("\n", "")
                            .replace("\r", "")
                            .lower()
                        )

                        if (
                            "storage" in normalized_header
                            and "description" in normalized_header
                        ):
                            if idx < len(row) and row[idx]:
                                result["storage_requirements"] = (
                                    str(row[idx]).replace("\n", " ").strip()
                                )
                                logger.info(
                                    "Found storage requirements: %s",
                                    result["storage_requirements"],
                                )
                                break

                    if result["storage_requirements"]:
                        break

                if result["storage_requirements"]:
                    break

        # Batch number extraction
        batch_patterns = [
            r"batch\s*number[:\s]+([A-Z0-9\-]+)",
            r"batch[:\s]+([A-Z0-9\-]+)",
            r"lot\s*number[:\s]+([A-Z0-9\-]+)",
            r"lot[:\s]+([A-Z0-9\-]+)",
        ]
        for pattern in batch_patterns:
            match = re.search(pattern, full_text, re.IGNORECASE)
            if match:
                result["batch_number"] = match.group(1)
                break

        # Expiration date extraction
        expiry_patterns = [
            r"expiration\s*date[:\s]+([0-9/\-]+)",
            r"expiry\s*date[:\s]+([0-9/\-]+)",
            r"exp\s*date[:\s]+([0-9/\-]+)",
        ]
        for pattern in expiry_patterns:
            match = re.search(pattern, full_text, re.IGNORECASE)
            if match:
                result["expiration_date"] = match.group(1)
                break

        # Fallback: regex match for storage description in raw text
        if not result["storage_requirements"]:
            storage_match = re.search(
                r"TE\s*-\sStore.?DC",
                full_text,
                re.IGNORECASE | re.DOTALL,
            )
            if storage_match:
                result["storage_requirements"] = (
                    storage_match.group(0).replace("\n", " ").strip()
                )

        logger.info("Storage extraction result: %s", result)
        return result

    except Exception as e:
        logger.error("Storage extraction failed: %s", str(e))
        raise ExtractionError(f"Failed to extract storage data: {str(e)}") from e
