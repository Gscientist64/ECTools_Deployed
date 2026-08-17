"""add email_log and utilization_result tables

Revision ID: c1d2e3f4a5b6
Revises: a1b2c3d4e5f6
Create Date: 2026-08-17 10:00:00.000000

Idempotent: both tables may already exist in a shared/dev DB (created by
db.create_all() on startup), so creation is guarded by an inspector check.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c1d2e3f4a5b6'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def _tables():
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def upgrade():
    if "email_log" not in _tables():
        op.create_table(
            'email_log',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('request_id', sa.Integer(), sa.ForeignKey('request.id'), nullable=True),
            sa.Column('email', sa.String(200), nullable=False),
            sa.Column('role', sa.String(50), nullable=False),
            sa.Column('status', sa.String(20), nullable=False),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )

    if "utilization_result" not in _tables():
        op.create_table(
            'utilization_result',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('facility', sa.String(200), nullable=False),
            sa.Column('tool_id', sa.Integer(), sa.ForeignKey('tool.id'), nullable=False),
            sa.Column('report_type', sa.String(20), nullable=False),
            sa.Column('date_column', sa.String(120), nullable=True),
            sa.Column('given', sa.Integer(), nullable=False),
            sa.Column('achieved', sa.Integer(), nullable=False),
            sa.Column('utilization_pct', sa.Float(), nullable=True),
            sa.Column('start_date', sa.Date(), nullable=True),
            sa.Column('daily_counts', sa.Text(), nullable=True),
            sa.Column('computed_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('facility', 'tool_id', name='uq_util_facility_tool'),
        )
        op.create_index('ix_utilization_result_facility', 'utilization_result', ['facility'])


def downgrade():
    op.drop_index('ix_utilization_result_facility', table_name='utilization_result')
    op.drop_table('utilization_result')
    op.drop_table('email_log')
