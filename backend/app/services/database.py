"""
Database service — reads material details from the local SQLite database.

DB location: backend/database/material_master.db
Schema: material_master(material_number, product_name, gtin,
                         quantity_per_case, inner_pack, label_specification_number)
"""
import logging
import os
import sqlite3

logger = logging.getLogger(__name__)

_DB_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "database", "material_master.db",
)
DB_PATH = os.path.normpath(_DB_PATH)


class MaterialNotFoundError(Exception):
    pass


class DatabaseUnavailableError(Exception):
    pass


def get_material_details(material_number: str) -> dict:
    """
    Fetch material details from the SQLite material_master database.

    Args:
        material_number: The material number to look up

    Returns:
        dict with keys: product_name, gtin, quantity_per_case,
                        inner_pack, label_specification_number

    Raises:
        MaterialNotFoundError: if the material number is not in the DB
        DatabaseUnavailableError: if the DB file cannot be opened
    """
    logger.info("Fetching material details for %s from %s", material_number, DB_PATH)

    if not os.path.exists(DB_PATH):
        raise DatabaseUnavailableError(
            f"Database file not found at {DB_PATH}"
        )

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                product_name,
                gtin,
                quantity_per_case,
                inner_pack,
                label_specification_number
            FROM material_master
            WHERE material_number = ?
            """,
            (material_number,),
        )
        row = cursor.fetchone()
        conn.close()
    except sqlite3.Error as e:
        logger.error("SQLite error: %s", str(e))
        raise DatabaseUnavailableError(f"Database error: {str(e)}") from e

    if not row:
        raise MaterialNotFoundError(
            f"Material number '{material_number}' not found in database"
        )

    return {
        "product_name": row[0],
        "gtin": row[1],
        "quantity_per_case": row[2],
        "inner_pack": row[3],
        "label_specification_number": row[4],
    }
