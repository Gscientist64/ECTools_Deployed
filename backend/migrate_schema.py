"""Run schema migrations to sync models.py with the PostgreSQL database."""
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

CONN_STRING = os.getenv("DATABASE_URL", "").replace("postgres://", "postgresql://", 1)

conn = psycopg2.connect(CONN_STRING)
conn.autocommit = True
cur = conn.cursor()

# 1. Add missing columns to request table
cur.execute("ALTER TABLE request ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500)")
cur.execute("ALTER TABLE request ADD COLUMN IF NOT EXISTS approved_by_id INTEGER REFERENCES users(id)")
cur.execute("ALTER TABLE request ADD COLUMN IF NOT EXISTS rejected_by_id INTEGER REFERENCES users(id)")
print("[OK] Added missing columns to request")

# 2. Check existing tables
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
tables = [r[0] for r in cur.fetchall()]
print(f"[INFO] Existing tables: {tables}")

# 3. Create delivery table if not exists
if "delivery" not in tables:
    cur.execute("""
        CREATE TABLE delivery (
            id SERIAL PRIMARY KEY,
            request_id INTEGER NOT NULL REFERENCES request(id),
            tool_id INTEGER NOT NULL REFERENCES tool(id),
            requested_tool_id INTEGER NOT NULL REFERENCES requested_tool(id),
            quantity_supplied INTEGER NOT NULL,
            basic_unit VARCHAR(50) NOT NULL,
            distributed_by INTEGER REFERENCES users(id),
            received_by INTEGER NOT NULL REFERENCES users(id),
            witnessed_by VARCHAR(200),
            is_delivered BOOLEAN DEFAULT FALSE,
            delivery_date TIMESTAMP,
            delivery_confirmed_at TIMESTAMP,
            delivery_note_path VARCHAR(500),
            delivery_note_generated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """)
    print("[OK] Created delivery table")

# 4. Create facility_stock table if not exists
if "facility_stock" not in tables:
    cur.execute("""
        CREATE TABLE facility_stock (
            id SERIAL PRIMARY KEY,
            tool_id INTEGER NOT NULL REFERENCES tool(id),
            facility VARCHAR(100) NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT uq_tool_facility UNIQUE (tool_id, facility)
        )
    """)
    print("[OK] Created facility_stock table")

# 5. Create department_distribution table if not exists
if "department_distribution" not in tables:
    cur.execute("""
        CREATE TABLE department_distribution (
            id SERIAL PRIMARY KEY,
            facility VARCHAR(100) NOT NULL,
            tool_id INTEGER NOT NULL REFERENCES tool(id),
            department VARCHAR(50) NOT NULL,
            quantity INTEGER NOT NULL,
            distributed_by INTEGER NOT NULL REFERENCES users(id),
            date_distributed TIMESTAMP DEFAULT NOW(),
            notes VARCHAR(300)
        )
    """)
    print("[OK] Created department_distribution table")

# 6. Create physical_stock_count table if not exists
if "physical_stock_count" not in tables:
    cur.execute("""
        CREATE TABLE physical_stock_count (
            id SERIAL PRIMARY KEY,
            facility VARCHAR(100) NOT NULL,
            tool_id INTEGER NOT NULL REFERENCES tool(id),
            system_quantity INTEGER NOT NULL,
            physical_quantity INTEGER NOT NULL,
            discrepancy INTEGER NOT NULL,
            counted_by INTEGER NOT NULL REFERENCES users(id),
            counted_at TIMESTAMP DEFAULT NOW(),
            notes VARCHAR(300)
        )
    """)
    print("[OK] Created physical_stock_count table")

# Verify columns in request
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='request'")
cols = [r[0] for r in cur.fetchall()]
print(f"[INFO] Request columns: {cols}")

conn.close()
print("[DONE] Migration complete")