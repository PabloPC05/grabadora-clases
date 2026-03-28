"""Initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-28 00:00:00.000000

Tablas: users, subjects, glossary_terms, recordings, notes, tasks
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

recording_status_col = sa.Enum(
    "pending", "processing", "completed", "failed",
    name="recordingstatus",
)
task_status_col = sa.Enum(
    "pending", "processing", "completed", "failed",
    name="taskstatus",
)


def upgrade() -> None:
    # -- users --
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # -- subjects --
    op.create_table(
        "subjects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_subjects_id", "subjects", ["id"])
    op.create_index("ix_subjects_user_id", "subjects", ["user_id"])

    # -- glossary_terms --
    op.create_table(
        "glossary_terms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term", sa.String(255), nullable=False),
        sa.Column("definition", sa.Text(), nullable=True),
    )
    op.create_index("ix_glossary_terms_id", "glossary_terms", ["id"])
    op.create_index("ix_glossary_terms_subject_id", "glossary_terms", ["subject_id"])

    # -- recordings --
    op.create_table(
        "recordings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("topic", sa.String(500), nullable=True),
        sa.Column("audio_path", sa.String(1000), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("status", recording_status_col, nullable=False, server_default="pending"),
        sa.Column("raw_transcript", sa.Text(), nullable=True),
        sa.Column("language_detected", sa.String(10), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_recordings_id", "recordings", ["id"])
    op.create_index("ix_recordings_user_id", "recordings", ["user_id"])
    op.create_index("ix_recordings_subject_id", "recordings", ["subject_id"])
    op.create_index("ix_recordings_status", "recordings", ["status"])

    # -- notes --
    op.create_table(
        "notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "recording_id",
            sa.Integer(),
            sa.ForeignKey("recordings.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("content_markdown", sa.Text(), nullable=False),
        sa.Column("key_concepts", sa.JSON(), nullable=True),
        sa.Column("review_questions", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_notes_id", "notes", ["id"])

    # -- tasks --
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("recording_id", sa.Integer(), sa.ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", task_status_col, nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_tasks_recording_id", "tasks", ["recording_id"])
    op.create_index("ix_tasks_status", "tasks", ["status"])


def downgrade() -> None:
    op.drop_table("tasks")
    op.drop_table("notes")
    op.drop_table("recordings")
    op.drop_table("glossary_terms")
    op.drop_table("subjects")
    op.drop_table("users")
    recording_status_col.drop(op.get_bind(), checkfirst=True)
    task_status_col.drop(op.get_bind(), checkfirst=True)
