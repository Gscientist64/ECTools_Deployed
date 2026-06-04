import pandas as pd
from app import create_app
from extensions import db
from models import ToolCategory, Tool

# Initialize the app
app = create_app()

# Load the Excel file
excel_file = "C:\Users\Administrator\Desktop\Softwares\Tools.xlsx"  # Update with the path to your file
data = pd.read_excel(excel_file)

# Ensure the file has the following columns: "Category", "Tool Name", "Description"
with app.app_context():
    for _, row in data.iterrows():
        # Fetch or create the category
        category_name = row["Category"]
        category = ToolCategory.query.filter_by(name=category_name).first()
        if not category:
            category = ToolCategory(name=category_name)
            db.session.add(category)
            db.session.commit()

        # Add the tool
        tool_name = row["Tool Name"]
        description = row["Description"]
        if not Tool.query.filter_by(name=tool_name, category_id=category.id).first():
            tool = Tool(name=tool_name, description=description, category=category)
            db.session.add(tool)

    db.session.commit()
    print("Tools imported successfully!")
