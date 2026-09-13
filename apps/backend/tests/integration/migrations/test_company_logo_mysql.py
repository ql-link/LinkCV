"""Focused MySQL checks against a reconstructed pre-logo metadata baseline.

The full historical migration suite remains a separate check; this fixture must
not be reported as proof that every historical revision upgrades successfully.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from time import sleep

from sqlalchemy import MetaData, create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker

import linkresume.models  # noqa: F401
from linkresume.application.job_descriptions.logo_service import attach_logo
from linkresume.core.database import Base
from linkresume.modules.job_descriptions.models import JobDescription
from tests.integration.api.test_company_logos import LogoStorage, picture
from tests.integration.migrations.test_mysql_migrations import (
    migration_test_url, reset_test_database_to_base, run_alembic,
)


def test_logo_column_upgrade_preserves_jobs_and_concurrent_upload_reuses_content():
    url = migration_test_url()
    reset_test_database_to_base(url)
    engine = create_engine(url)
    baseline = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(baseline)
    table = baseline.tables['job_descriptions']
    table._columns.remove(table.c.logo_sha256)
    baseline.create_all(engine)
    run_alembic(url, 'stamp', '0061')
    before_tables = set(inspect(engine).get_table_names())
    with engine.begin() as connection:
        user = connection.execute(baseline.tables['users'].insert().values(email='logo-migration@example.test', password_hash='fictional', nickname='张三')).lastrowid
        for title in ['岗位一', '岗位二']:
            connection.execute(table.insert().values(user_id=user, job_title=title, company_name='示例公司', logo_url='https://example.test/old.png', description='测试正文', skills=[], source_type='manual'))
    run_alembic(url, 'upgrade', 'head')
    run_alembic(url, 'upgrade', 'head')
    inspector = inspect(engine)
    assert set(inspector.get_table_names()) == before_tables
    column = next(col for col in inspector.get_columns('job_descriptions') if col['name'] == 'logo_sha256')
    assert column['nullable'] and column['type'].length == 64
    with engine.connect() as connection:
        rows = connection.execute(text('SELECT job_title, logo_url, logo_sha256 FROM job_descriptions ORDER BY id')).all()
        assert rows == [('岗位一', 'https://example.test/old.png', None), ('岗位二', 'https://example.test/old.png', None)]
        info = connection.execute(text("SELECT character_set_name, collation_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='job_descriptions' AND column_name='logo_sha256'")).one()
        assert info == ('ascii', 'ascii_bin')

    class SlowStorage(LogoStorage):
        def put(self, *args, **kwargs):
            sleep(0.15)
            super().put(*args, **kwargs)

    storage = SlowStorage()
    sessions = sessionmaker(engine, expire_on_commit=False)
    barrier = Barrier(2)
    def save(job_id):
        with sessions() as db:
            job = db.get(JobDescription, job_id)
            barrier.wait(timeout=5)
            return attach_logo(db, storage, job, picture(), mode='fill_missing', expected_revision=None)
    with sessions() as db:
        ids = list(db.scalars(select(JobDescription.id)))
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(save, ids))
    assert results[0]['revision'] == results[1]['revision']
    assert storage.writes == 1
    with sessions() as db:
        assert list(db.scalars(select(JobDescription.logo_sha256))) == [results[0]['revision']] * 2
    engine.dispose()
