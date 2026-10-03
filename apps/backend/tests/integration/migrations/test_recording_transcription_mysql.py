"""0109 upgrade and owner serialization on disposable local MySQL 8.4 schemas."""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url

from linkresume.application.interviews.transcription_service import create_task
from linkresume.core.config import load_settings
from linkresume.core.errors import ApiError
from linkresume.modules.datasets.models import DatasetTranscriptionTask
from linkresume.modules.identity.models import User
from tests.integration.api.test_interview_transcription import make_app, audio
from tests.integration.api.test_interview_prep import create_session
from tests.integration.api.test_interviews import register

BACKEND=Path(__file__).resolve().parents[3]


@pytest.fixture(params=['base','0105'])
def mysql(request):
    raw=os.environ.get('LINKRESUME_TEST_MYSQL_URL')
    if not raw: pytest.skip('Explicit disposable local MySQL connection required')
    url=make_url(raw)
    if url.host not in ('127.0.0.1','localhost'): pytest.fail('Only local disposable schemas permitted')
    name='linkresume_asr_test_'+uuid4().hex[:12]
    admin=create_engine(url)
    with admin.connect() as db:
        assert str(db.scalar(text('SELECT VERSION()'))).startswith('8.4.')
        db.execute(text(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'))
    target=url.set(database=name).render_as_string(hide_password=False)
    old=os.environ.get('DATABASE_URL')
    engine=create_engine(target)
    try:
        os.environ['DATABASE_URL']=target; load_settings.cache_clear()
        cfg=Config(str(BACKEND/'alembic.ini'));cfg.set_main_option('script_location',str(BACKEND/'migrations'))
        if request.param=='0105':
            command.upgrade(cfg,'0105')
            with engine.begin() as db:
                db.execute(text("INSERT INTO users (email,password_hash,nickname) VALUES ('historical-asr@example.test','fictional-hash','张三')"))
        command.upgrade(cfg,'head')
        if request.param=='0105':
            with engine.connect() as db:
                assert db.scalar(text("SELECT nickname FROM users WHERE email='historical-asr@example.test'"))=='张三'
        yield engine
    finally:
        if old is None: os.environ.pop('DATABASE_URL',None)
        else: os.environ['DATABASE_URL']=old
        load_settings.cache_clear();engine.dispose()
        with admin.connect() as db: db.execute(text(f'DROP DATABASE `{name}`'))
        admin.dispose()


def test_0109_schema_matches_orm_and_preserves_history(mysql):
    engine=mysql
    with engine.connect() as db:
        assert db.scalar(text('SELECT version_num FROM alembic_version'))=='0109'
        assert db.scalar(text('SELECT COUNT(*) FROM dataset_transcription_tasks'))==0
    actual=inspect(engine)
    columns=actual.get_columns('dataset_transcription_tasks')
    assert len(columns)==14
    assert {c['name'] for c in columns}==set(DatasetTranscriptionTask.__table__.columns.keys())
    expected={c.name:c for c in DatasetTranscriptionTask.__table__.columns}
    for column in columns:
        orm=expected[column['name']]
        assert column['type'].compile(dialect=engine.dialect)==orm.type.compile(dialect=engine.dialect)
        assert column['nullable']==orm.nullable
    foreign={item['referred_table']:item['options']['ondelete'] for item in actual.get_foreign_keys('dataset_transcription_tasks')}
    assert foreign=={'users':'RESTRICT','user_dataset':'CASCADE','interview_sessions':'SET NULL'}
    assert {c['name'] for c in actual.get_check_constraints('dataset_transcription_tasks')}=={'ck_transcription_status','ck_transcription_terminal_lease'}


def test_mysql_user_lock_serializes_admission_for_different_recordings(mysql,tmp_path):
    app,_,_=make_app(tmp_path,database_url=mysql.url.render_as_string(hide_password=False))
    with TestClient(app) as client:
        register(client,'mysql-asr-owner@example.test'); session=create_session(client)
        files=[audio(client,session),audio(client,session)]
    with app.state.session_factory() as db: uid=db.scalar(select(User.id).where(User.email=='mysql-asr-owner@example.test'))
    barrier=Barrier(2)
    def submit(asset):
        with app.state.session_factory() as db:
            barrier.wait(timeout=5)
            try:
                create_task(db,uid,int(session['id']),int(asset['id']),uuid4(),settings=app.state.settings,llm=app.state.llm_service)
                return 'accepted'
            except ApiError as error:
                db.rollback(); return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(submit,files))
    assert sorted(results)==['INTERVIEW_TRANSCRIPTION_BUSY','accepted']
    with app.state.session_factory() as db:
        assert len(db.scalars(select(DatasetTranscriptionTask)).all())==1
        # A history dominated by terminal tasks should use the scheduling index;
        # the rarer first recording should use its lookup index.
        db.add_all([DatasetTranscriptionTask(user_id=uid,dataset_id=int(files[1]['id']),
            interview_session_id=int(session['id']),client_request_id=str(uuid4()),
            status='ready',route_snapshot={},result_json={'schema_version':1,'text':'虚构记录'}) for _ in range(200)])
        db.commit()
        plans=db.execute(text("EXPLAIN SELECT id FROM dataset_transcription_tasks WHERE status IN ('queued','submitting','transcribing') ORDER BY updated_at,id LIMIT 50")).mappings().all()
        assert plans[0]['key']=='idx_transcription_poll'
        plans=db.execute(text("EXPLAIN SELECT id FROM dataset_transcription_tasks WHERE dataset_id=:dataset ORDER BY id DESC LIMIT 1"),{'dataset':int(files[0]['id'])}).mappings().all()
        assert plans[0]['key']=='idx_transcription_dataset'
    app.state.session_factory.kw["bind"].dispose()
