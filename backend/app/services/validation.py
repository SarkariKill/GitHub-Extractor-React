"""
Validation helpers for extracted shipper data.
"""


def get_missing_fields(data: dict) -> list[tuple[str, str]]:
    """
    Return a list of (field_key, field_label) tuples for any required
    fields that are missing or blank in the extracted data.

    Args:
        data: Dict of extracted shipper fields

    Returns:
        List of (key, label) tuples for missing fields (empty if all present)
    """
    required_fields = {
        "storage_requirements": "Storage Requirements",
        "batch_number": "Batch/Lot Number",
        "expiration_date": "Expiration Date",
        "active_ingredient": "Active Ingredient",
    }

    missing = []
    for key, label in required_fields.items():
        if data.get(key) is None or str(data.get(key)).strip() == "":
            missing.append((key, label))

    return missing
