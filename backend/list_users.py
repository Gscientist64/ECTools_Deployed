from app import create_app
from models import Users

app = create_app()
with app.app_context():
    for u in Users.query.all():
        print(f"ID={u.id} | username={u.username} | role={u.roles} | facility={u.facility} | pw={u.password}")