import sys
sys.path.insert(0, 'c:/ECEWS_ToolsApp_FinalDev/backend')
from app import create_app
from extensions import db
from sqlalchemy import inspect, text

app = create_app()
app.app_context().push()
inspector = inspect(db.engine)

print("=== INDEXES ===")
for table in sorted(inspector.get_table_names()):
    indexes = inspector.get_indexes(table)
    if indexes:
        print(f'\n--- {table} ---')
        for idx in indexes:
            print(f'  {idx["name"]}: {idx["column_names"]} (unique={idx["unique"]})')

print('\n=== ROW COUNTS ===')
for table in sorted(inspector.get_table_names()):
    count = db.session.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
    print(f'  {table}: {count} rows')
