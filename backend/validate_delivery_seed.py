"""Validate delivery_seed.xlsx before import."""
import pandas as pd
import sys
sys.path.insert(0, 'c:/ECEWS_ToolsApp_FinalDev/backend')
from app import create_app
from models import Users, Tool
from extensions import db

app = create_app()
app.app_context().push()

df = pd.read_excel('c:/ECEWS_ToolsApp_FinalDev/delivery_seed.xlsx', sheet_name='Delivery Notes')
print(f"Total rows: {len(df)}")

# Get existing data
db_tools = {t.name.lower().strip(): t for t in Tool.query.all()}
db_users = Users.query.all()
db_facilities = {}
for u in db_users:
    if u.facility:
        key = u.facility.lower().strip()
        if key not in db_facilities:
            db_facilities[key] = []
        db_facilities[key].append(u)

# Validate
issues = []
for i, row in df.iterrows():
    fac = str(row['Facility']).strip()
    tool_name = str(row['Tool Name']).strip()
    
    fac_key = fac.lower()
    if fac_key not in db_facilities:
        issues.append(f'Row {i}: Facility "{fac}" has NO user in DB')
    
    tool_key = tool_name.lower()
    if tool_key not in db_tools:
        issues.append(f'Row {i}: Tool "{tool_name}" NOT FOUND in DB')

if issues:
    print(f'\n=== {len(issues)} ISSUES FOUND ===')
    for iss in issues:
        print(f'  {iss}')
else:
    print('\nALL ROWS VALID - no issues!')

print('\n=== Facilities in Excel with NO DB user ===')
excel_facs = set(str(f).strip().lower() for f in df['Facility'])
for f in sorted(excel_facs):
    if f not in db_facilities:
        print(f'  {f}')

print('\n=== DB users by facility (for reference) ===')
for f in sorted(db_facilities):
    users = db_facilities[f]
    print(f'  {f}: {[(u.id, u.username) for u in users]}')
