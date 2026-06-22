"""Add performance indexes to existing tables. Safe to run multiple times."""
import sys
sys.path.insert(0, 'c:/ECEWS_ToolsApp_FinalDev/backend')
from app import create_app
from extensions import db
from sqlalchemy import text

INDEXES = [
    # Delivery table - heavily queried in joins
    "CREATE INDEX IF NOT EXISTS idx_delivery_request_id ON delivery(request_id)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_is_delivered ON delivery(is_delivered)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_tool_id ON delivery(tool_id)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_received_by ON delivery(received_by)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_delivery_date ON delivery(delivery_date)",
    # Request table
    "CREATE INDEX IF NOT EXISTS idx_request_user_id ON request(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_request_status ON request(status)",
    "CREATE INDEX IF NOT EXISTS idx_request_date_requested ON request(date_requested)",
    # RequestedTool table
    "CREATE INDEX IF NOT EXISTS idx_requested_tool_request_id ON requested_tool(request_id)",
    "CREATE INDEX IF NOT EXISTS idx_requested_tool_tool_id ON requested_tool(tool_id)",
    "CREATE INDEX IF NOT EXISTS idx_requested_tool_status ON requested_tool(status)",
    # ToolUsage
    "CREATE INDEX IF NOT EXISTS idx_tool_usage_tool_id ON tool_usage(tool_id)",
    "CREATE INDEX IF NOT EXISTS idx_tool_usage_user_id ON tool_usage(user_id)",
    # NotificationRead
    "CREATE INDEX IF NOT EXISTS idx_notification_read_user_id ON notification_read(user_id)",
    # Tool
    "CREATE INDEX IF NOT EXISTS idx_tool_category_id ON tool(category_id)",
]

app = create_app()
with app.app_context():
    print("Adding performance indexes...")
    for idx_sql in INDEXES:
        try:
            db.session.execute(text(idx_sql))
            print(f"  ✓ {idx_sql.split('ON')[1].strip().split('(')[0]}")
        except Exception as e:
            print(f"  ⚠ {e}")
    db.session.commit()
    print("\nDone! Indexes added.")

    # Show current indexes
    from sqlalchemy import inspect
    inspector = inspect(db.engine)
    print("\n=== All indexes now ===")
    for table in sorted(inspector.get_table_names()):
        indexes = inspector.get_indexes(table)
        for idx in indexes:
            print(f"  {table}.{idx['name']}: {idx['column_names']}")
