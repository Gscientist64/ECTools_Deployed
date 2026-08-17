"""add S.I. approved quantities to requested_tool and supervisor_action

Revision ID: a1b2c3d4e5f6
Revises: 93ae5d597fb3
Create Date: 2026-08-14 18:15:00.000000

Idempotent: the columns may already exist in a shared/dev DB that was migrated
manually, so each add is guarded by an inspector check.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '93ae5d597fb3'
branch_labels = None
depends_on = None


def _columns(table):
    bind = op.get_bind()
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade():
    if "approved_quantity" not in _columns("requested_tool"):
        with op.batch_alter_table('requested_tool', schema=None) as batch_op:
            batch_op.add_column(sa.Column('approved_quantity', sa.Integer(), nullable=True))

    if "approved_quantities" not in _columns("supervisor_action"):
        with op.batch_alter_table('supervisor_action', schema=None) as batch_op:
            batch_op.add_column(sa.Column('approved_quantities', sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table('supervisor_action', schema=None) as batch_op:
        batch_op.drop_column('approved_quantities')

    with op.batch_alter_table('requested_tool', schema=None) as batch_op:
        batch_op.drop_column('approved_quantity')
